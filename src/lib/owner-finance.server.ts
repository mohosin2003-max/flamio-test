/**
 * Server-only math for Owner Finance and Profit Partners.
 *
 * The business profit figure is the EXISTING authoritative one used by the
 * owner sales report: completed-order revenue for the period minus purchases
 * recorded in the same period. Owner withdrawals and partner payments are a
 * separate ledger layer — they are never treated as business expenses, so they
 * cannot change this number.
 */

export type MonthBounds = { from: string; to: string; lastDay: string };

/** `2026-10` → 2026-10-01 (inclusive) .. 2026-11-01 (exclusive). */
export function monthRange(month: string): MonthBounds {
  const [y, m] = month.split("-").map(Number);
  const year = y!;
  const mon = m!;
  const from = `${month}-01`;
  const next =
    mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(new Date(`${next}T00:00:00Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { from, to: next, lastDay };
}

export function currentMonth(): string {
  // Dhaka time, so a late-evening entry lands in the right month.
  return new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 7);
}

export function addMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m! === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
}

/** Every month from `start` up to and including `end`. */
export function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end && months.length < 240) {
    months.push(cursor);
    cursor = addMonth(cursor);
  }
  return months;
}

const round = (value: number) => Number(value.toFixed(2));

/**
 * Net business profit for a date range, using the same rule as the owner sales
 * report: revenue counts only for completed orders, expenses are purchases.
 */
export async function netProfitForRange(
  fromDate: string,
  toDateExclusive: string,
): Promise<{ revenue: number; expenses: number; net: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const fromIso = new Date(`${fromDate}T00:00:00+06:00`).toISOString();
  const toIso = new Date(`${toDateExclusive}T00:00:00+06:00`).toISOString();

  const [orders, purchases] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("total, status, created_at")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .limit(10_000),
    supabaseAdmin
      .from("purchases")
      .select("total_price")
      .gte("purchased_on", fromDate)
      .lt("purchased_on", toDateExclusive)
      .limit(10_000),
  ]);

  if (orders.error || purchases.error) {
    console.error("Profit calculation failed", orders.error ?? purchases.error);
    throw new Error("We couldn't work out the business profit. Please try again.");
  }

  const revenue = (orders.data ?? [])
    .filter((row) => row.status === "completed")
    .reduce((sum, row) => sum + Number(row.total), 0);
  const expenses = (purchases.data ?? []).reduce((sum, row) => sum + Number(row.total_price), 0);

  return { revenue: round(revenue), expenses: round(expenses), net: round(revenue - expenses) };
}

export async function netProfitForMonth(month: string) {
  const { from, to } = monthRange(month);
  return netProfitForRange(from, to);
}

/** Net profit for everything recorded so far. */
export async function netProfitAllTime() {
  return netProfitForRange("2000-01-01", addMonth(currentMonth()).concat("-01"));
}

export type PartnerTerm = {
  id: string;
  userId: string;
  sharePercent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  createdAt: string;
};

export type PartnerMonth = {
  month: string;
  sharePercent: number;
  businessProfit: number;
  earned: number;
};

export async function readPartnerTerms(userId?: string): Promise<PartnerTerm[]> {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  const db = await untypedAdmin();
  let query = db
    .from("profit_partner_terms")
    .select("id, user_id, share_percent, effective_from, effective_to, note, created_at")
    .order("effective_from", { ascending: true });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    console.error("Partner terms read failed", error);
    throw new Error("We couldn't load profit partner settings. Please run the setup SQL first.");
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row["id"]),
    userId: String(row["user_id"]),
    sharePercent: Number(row["share_percent"]),
    effectiveFrom: String(row["effective_from"]),
    effectiveTo: (row["effective_to"] as string | null) ?? null,
    note: (row["note"] as string | null) ?? null,
    createdAt: String(row["created_at"]),
  }));
}

/** The term that applies to a whole month, if any. */
export function termForMonth(terms: PartnerTerm[], month: string): PartnerTerm | null {
  const { from, lastDay } = monthRange(month);
  return (
    terms.find(
      (term) =>
        term.effectiveFrom <= lastDay && (term.effectiveTo === null || term.effectiveTo >= from),
    ) ?? null
  );
}

/**
 * Month-by-month earnings for one partner. Nothing is produced for months
 * before the first effective-from date, and each month uses the percentage
 * that was in force then — later percentage changes never rewrite history.
 */
export async function partnerMonthlyEarnings(
  terms: PartnerTerm[],
  profitByMonth: Map<string, number>,
): Promise<PartnerMonth[]> {
  if (terms.length === 0) return [];
  const start = terms[0]!.effectiveFrom.slice(0, 7);
  const months = monthsBetween(start, currentMonth());
  const rows: PartnerMonth[] = [];

  for (const month of months) {
    const term = termForMonth(terms, month);
    if (!term) continue;
    let profit = profitByMonth.get(month);
    if (profit === undefined) {
      profit = (await netProfitForMonth(month)).net;
      profitByMonth.set(month, profit);
    }
    const basis = Math.max(profit, 0);
    rows.push({
      month,
      sharePercent: term.sharePercent,
      businessProfit: round(profit),
      earned: round((basis * term.sharePercent) / 100),
    });
  }

  return rows.sort((a, b) => b.month.localeCompare(a.month));
}

export type PartnerPayment = {
  id: string;
  userId: string;
  amount: number;
  paidOn: string;
  periodMonth: string | null;
  paymentMethod: string | null;
  note: string | null;
  createdAt: string;
};

export async function readPartnerPayments(userId?: string): Promise<PartnerPayment[]> {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  const db = await untypedAdmin();
  let query = db
    .from("partner_profit_payments")
    .select("id, user_id, amount, paid_on, period_month, payment_method, note, created_at")
    .order("paid_on", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) {
    console.error("Partner payments read failed", error);
    throw new Error("We couldn't load partner payments. Please run the setup SQL first.");
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row["id"]),
    userId: String(row["user_id"]),
    amount: Number(row["amount"]),
    paidOn: String(row["paid_on"]),
    periodMonth: (row["period_month"] as string | null) ?? null,
    paymentMethod: (row["payment_method"] as string | null) ?? null,
    note: (row["note"] as string | null) ?? null,
    createdAt: String(row["created_at"]),
  }));
}

export { round as roundMoney };
