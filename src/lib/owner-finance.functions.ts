import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Owner Finance & Profit Partners.
 *
 * - Business profit comes from the EXISTING authoritative calculation
 *   (completed-order revenue minus purchases), reused through
 *   `owner-finance.server.ts`. Nothing here changes it.
 * - Owner withdrawals and partner payments are their own records; they are
 *   never counted as business expenses and never touch salary/money-taken.
 * - Owner endpoints re-check the caller with `assertOwner`. The partner's own
 *   view is hard-scoped to `context.userId`, so no request can reach another
 *   person's finances.
 */

export const FINANCE_PAYMENT_METHODS = ["cash", "bank", "mobile"] as const;
export type FinancePaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const methodSchema = z.enum(FINANCE_PAYMENT_METHODS).nullable().optional();

export type OwnerWithdrawal = {
  id: string;
  amount: number;
  entryDate: string;
  entryTime: string | null;
  periodMonth: string;
  reason: string;
  note: string | null;
  paymentMethod: FinancePaymentMethod | null;
  createdAt: string;
};

export type OwnerFinanceOverview = {
  month: string;
  monthProfit: number;
  monthRevenue: number;
  monthExpenses: number;
  monthWithdrawn: number;
  monthRetained: number;
  totalProfit: number;
  totalWithdrawn: number;
  totalRetained: number;
  withdrawals: OwnerWithdrawal[];
  monthlyProfit: { month: string; profit: number; withdrawn: number; retained: number }[];
  partnerEarnedThisMonth: number;
};

async function readWithdrawals(): Promise<OwnerWithdrawal[]> {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  const db = await untypedAdmin();
  const { data, error } = await db
    .from("owner_withdrawals")
    .select("id, amount, entry_date, entry_time, period_month, reason, note, payment_method, created_at")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("Owner withdrawals read failed", error);
    throw new Error("We couldn't load your withdrawals. Please run the setup SQL first.");
  }
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row["id"]),
    amount: Number(row["amount"]),
    entryDate: String(row["entry_date"]),
    entryTime: (row["entry_time"] as string | null) ?? null,
    periodMonth: String(row["period_month"]),
    reason: String(row["reason"]),
    note: (row["note"] as string | null) ?? null,
    paymentMethod: (row["payment_method"] as FinancePaymentMethod | null) ?? null,
    createdAt: String(row["created_at"]),
  }));
}

/** Owner-only finance summary: profit, withdrawals and retained profit. */
export const ownerGetFinanceOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data, context }): Promise<OwnerFinanceOverview> => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const finance = await import("@/lib/owner-finance.server");

    const withdrawals = await readWithdrawals();
    const [monthFigures, allTime] = await Promise.all([
      finance.netProfitForMonth(data.month),
      finance.netProfitAllTime(),
    ]);

    const monthWithdrawn = withdrawals
      .filter((w) => w.periodMonth === data.month)
      .reduce((sum, w) => sum + w.amount, 0);
    const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amount, 0);

    // Last 12 months of profit vs withdrawals, for the history table.
    const months: string[] = [];
    let cursor = data.month;
    for (let i = 0; i < 12; i += 1) {
      months.push(cursor);
      const [y, m] = cursor.split("-").map(Number);
      cursor = m! === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, "0")}`;
    }
    const monthlyProfit = [];
    for (const month of months) {
      const profit = month === data.month ? monthFigures.net : (await finance.netProfitForMonth(month)).net;
      const withdrawn = withdrawals
        .filter((w) => w.periodMonth === month)
        .reduce((sum, w) => sum + w.amount, 0);
      monthlyProfit.push({ month, profit, withdrawn, retained: finance.roundMoney(profit - withdrawn) });
    }

    // Partner earnings for the month are shown for context only; they do not
    // change the business profit figure above.
    const terms = await finance.readPartnerTerms();
    const byUser = new Map<string, typeof terms>();
    for (const term of terms) {
      byUser.set(term.userId, [...(byUser.get(term.userId) ?? []), term]);
    }
    let partnerEarnedThisMonth = 0;
    for (const list of byUser.values()) {
      const term = finance.termForMonth(list, data.month);
      if (!term) continue;
      partnerEarnedThisMonth += (Math.max(monthFigures.net, 0) * term.sharePercent) / 100;
    }

    return {
      month: data.month,
      monthProfit: monthFigures.net,
      monthRevenue: monthFigures.revenue,
      monthExpenses: monthFigures.expenses,
      monthWithdrawn: finance.roundMoney(monthWithdrawn),
      monthRetained: finance.roundMoney(monthFigures.net - monthWithdrawn),
      totalProfit: allTime.net,
      totalWithdrawn: finance.roundMoney(totalWithdrawn),
      totalRetained: finance.roundMoney(allTime.net - totalWithdrawn),
      withdrawals,
      monthlyProfit,
      partnerEarnedThisMonth: finance.roundMoney(partnerEarnedThisMonth),
    };
  });

/** Owner records money taken out of business profit. */
export const ownerRecordWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        amount: z.number().positive().max(100_000_000),
        entryDate: dateSchema,
        entryTime: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable()
          .optional(),
        reason: z.string().trim().min(2).max(200),
        note: z.string().trim().max(300).nullable().optional(),
        paymentMethod: methodSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();

    const { error } = await db.from("owner_withdrawals").insert({
      amount: data.amount,
      entry_date: data.entryDate,
      entry_time: data.entryTime ?? null,
      period_month: data.entryDate.slice(0, 7),
      reason: data.reason,
      note: data.note ?? null,
      payment_method: data.paymentMethod ?? null,
      created_by: context.userId,
    });

    if (error) {
      console.error("Owner withdrawal insert failed", error);
      throw new Error("We couldn't save this withdrawal. Please try again.");
    }
    return { ok: true };
  });

export type PartnerSummary = {
  userId: string;
  fullName: string | null;
  phone: string | null;
  status: "active" | "ended";
  sharePercent: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  monthEarned: number;
  monthPaid: number;
  monthRemaining: number;
  totalEarned: number;
  totalPaid: number;
  totalRemaining: number;
  months: { month: string; sharePercent: number; businessProfit: number; earned: number; paid: number; remaining: number }[];
  terms: { id: string; sharePercent: number; effectiveFrom: string; effectiveTo: string | null; note: string | null }[];
  payments: { id: string; amount: number; paidOn: string; periodMonth: string | null; paymentMethod: string | null; note: string | null }[];
};

/** Owner-only: every profit partner with earnings, payments and balances. */
export const ownerListPartners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data, context }): Promise<PartnerSummary[]> => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const finance = await import("@/lib/owner-finance.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [terms, payments] = await Promise.all([
      finance.readPartnerTerms(),
      finance.readPartnerPayments(),
    ]);
    const userIds = [...new Set(terms.map((t) => t.userId))];
    if (userIds.length === 0) return [];

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, phone")
      .in("id", userIds);
    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    const profitByMonth = new Map<string, number>();
    const result: PartnerSummary[] = [];

    for (const userId of userIds) {
      const own = terms.filter((t) => t.userId === userId);
      const ownPayments = payments.filter((p) => p.userId === userId);
      const monthly = await finance.partnerMonthlyEarnings(own, profitByMonth);
      const current = finance.termForMonth(own, data.month);
      const active = own.some((t) => t.effectiveTo === null);

      const paidForMonth = (month: string) =>
        ownPayments
          .filter((p) => (p.periodMonth ?? p.paidOn.slice(0, 7)) === month)
          .reduce((sum, p) => sum + p.amount, 0);

      const totalEarned = monthly.reduce((sum, m) => sum + m.earned, 0);
      const totalPaid = ownPayments.reduce((sum, p) => sum + p.amount, 0);
      const monthEarned = monthly.find((m) => m.month === data.month)?.earned ?? 0;
      const monthPaid = paidForMonth(data.month);
      const profile = profileById.get(userId);

      result.push({
        userId,
        fullName: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        status: active ? "active" : "ended",
        sharePercent: current?.sharePercent ?? own.at(-1)?.sharePercent ?? null,
        effectiveFrom: own[0]?.effectiveFrom ?? null,
        effectiveTo: own.at(-1)?.effectiveTo ?? null,
        monthEarned: finance.roundMoney(monthEarned),
        monthPaid: finance.roundMoney(monthPaid),
        monthRemaining: finance.roundMoney(monthEarned - monthPaid),
        totalEarned: finance.roundMoney(totalEarned),
        totalPaid: finance.roundMoney(totalPaid),
        totalRemaining: finance.roundMoney(totalEarned - totalPaid),
        months: monthly.map((m) => {
          const paid = paidForMonth(m.month);
          return {
            ...m,
            paid: finance.roundMoney(paid),
            remaining: finance.roundMoney(m.earned - paid),
          };
        }),
        terms: own.map((t) => ({
          id: t.id,
          sharePercent: t.sharePercent,
          effectiveFrom: t.effectiveFrom,
          effectiveTo: t.effectiveTo,
          note: t.note,
        })),
        payments: ownPayments.map((p) => ({
          id: p.id,
          amount: p.amount,
          paidOn: p.paidOn,
          periodMonth: p.periodMonth,
          paymentMethod: p.paymentMethod,
          note: p.note,
        })),
      });
    }

    return result.sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
  });

/**
 * Enables a partner, or sets a new percentage from a future date. The current
 * open period is closed the day before the new one starts, so months already
 * earned keep the percentage they were earned under.
 */
export const ownerSavePartnerTerm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        sharePercent: z.number().positive().max(100),
        effectiveFrom: dateSchema,
        note: z.string().trim().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const finance = await import("@/lib/owner-finance.server");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();

    // The person must already exist as staff/manager — no second account.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId);
    const roleList = (roles ?? []).map((r) => r.role as string);
    if (!roleList.some((r) => r === "staff" || r === "admin" || r === "owner")) {
      return { ok: false as const, message: "Only an existing team member can be a profit partner." };
    }

    const own = await finance.readPartnerTerms(data.userId);
    const open = own.find((t) => t.effectiveTo === null);

    if (open) {
      if (data.effectiveFrom <= open.effectiveFrom) {
        return {
          ok: false as const,
          message: "Choose a start date after the current profit share period began.",
        };
      }
      const closeOn = new Date(new Date(`${data.effectiveFrom}T00:00:00Z`).getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const { error: closeError } = await db
        .from("profit_partner_terms")
        .update({ effective_to: closeOn })
        .eq("id", open.id);
      if (closeError) {
        console.error("Partner term close failed", closeError);
        throw new Error("We couldn't update this partner. Please try again.");
      }
    }

    const { error } = await db.from("profit_partner_terms").insert({
      user_id: data.userId,
      share_percent: data.sharePercent,
      effective_from: data.effectiveFrom,
      note: data.note ?? null,
      created_by: context.userId,
    });
    if (error) {
      console.error("Partner term insert failed", error);
      throw new Error("We couldn't save this partner. Please run the setup SQL first.");
    }
    return { ok: true as const };
  });

/** Stops future profit share. Past earnings and payments stay untouched. */
export const ownerEndPartner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), effectiveTo: dateSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const finance = await import("@/lib/owner-finance.server");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();

    const own = await finance.readPartnerTerms(data.userId);
    const open = own.find((t) => t.effectiveTo === null);
    if (!open) return { ok: false as const, message: "This partner is already disabled." };
    if (data.effectiveTo < open.effectiveFrom) {
      return { ok: false as const, message: "The end date must be after the start date." };
    }

    const { error } = await db
      .from("profit_partner_terms")
      .update({ effective_to: data.effectiveTo })
      .eq("id", open.id);
    if (error) {
      console.error("Partner end failed", error);
      throw new Error("We couldn't disable this partner. Please try again.");
    }
    return { ok: true as const };
  });

/** Owner pays a partner. Lowers what is still owed; earned stays as it was. */
export const ownerRecordPartnerPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        amount: z.number().positive().max(100_000_000),
        paidOn: dateSchema,
        periodMonth: monthSchema.nullable().optional(),
        paymentMethod: methodSchema,
        note: z.string().trim().max(300).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();

    const { error } = await db.from("partner_profit_payments").insert({
      user_id: data.userId,
      amount: data.amount,
      paid_on: data.paidOn,
      period_month: data.periodMonth ?? data.paidOn.slice(0, 7),
      payment_method: data.paymentMethod ?? null,
      note: data.note ?? null,
      created_by: context.userId,
    });
    if (error) {
      console.error("Partner payment insert failed", error);
      throw new Error("We couldn't save this payment. Please try again.");
    }
    return { ok: true };
  });

export type MyProfitShare = {
  isPartner: boolean;
  status: "active" | "ended" | "none";
  sharePercent: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  month: string;
  monthBusinessProfit: number;
  monthEarned: number;
  monthPaid: number;
  monthRemaining: number;
  totalEarned: number;
  totalPaid: number;
  totalRemaining: number;
  months: { month: string; sharePercent: number; businessProfit: number; earned: number; paid: number; remaining: number }[];
  payments: { id: string; amount: number; paidOn: string; periodMonth: string | null; note: string | null }[];
};

/**
 * A partner's OWN profit share. Every read is scoped to `context.userId`, so
 * owner withdrawals, other partners and staff salaries are unreachable here.
 */
export const staffGetMyProfitShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ month: monthSchema }).parse(input))
  .handler(async ({ data, context }): Promise<MyProfitShare> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "own_profit_share", "view");
    const finance = await import("@/lib/owner-finance.server");

    const empty: MyProfitShare = {
      isPartner: false,
      status: "none",
      sharePercent: null,
      effectiveFrom: null,
      effectiveTo: null,
      month: data.month,
      monthBusinessProfit: 0,
      monthEarned: 0,
      monthPaid: 0,
      monthRemaining: 0,
      totalEarned: 0,
      totalPaid: 0,
      totalRemaining: 0,
      months: [],
      payments: [],
    };

    const terms = await finance.readPartnerTerms(context.userId);
    if (terms.length === 0) return empty;

    const payments = await finance.readPartnerPayments(context.userId);
    const monthly = await finance.partnerMonthlyEarnings(terms, new Map());
    const current = finance.termForMonth(terms, data.month);
    const paidForMonth = (month: string) =>
      payments
        .filter((p) => (p.periodMonth ?? p.paidOn.slice(0, 7)) === month)
        .reduce((sum, p) => sum + p.amount, 0);

    const totalEarned = monthly.reduce((sum, m) => sum + m.earned, 0);
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const thisMonth = monthly.find((m) => m.month === data.month);
    const monthPaid = paidForMonth(data.month);

    return {
      isPartner: true,
      status: terms.some((t) => t.effectiveTo === null) ? "active" : "ended",
      sharePercent: current?.sharePercent ?? terms.at(-1)?.sharePercent ?? null,
      effectiveFrom: terms[0]?.effectiveFrom ?? null,
      effectiveTo: terms.at(-1)?.effectiveTo ?? null,
      month: data.month,
      monthBusinessProfit: thisMonth?.businessProfit ?? 0,
      monthEarned: finance.roundMoney(thisMonth?.earned ?? 0),
      monthPaid: finance.roundMoney(monthPaid),
      monthRemaining: finance.roundMoney((thisMonth?.earned ?? 0) - monthPaid),
      totalEarned: finance.roundMoney(totalEarned),
      totalPaid: finance.roundMoney(totalPaid),
      totalRemaining: finance.roundMoney(totalEarned - totalPaid),
      months: monthly.map((m) => {
        const paid = paidForMonth(m.month);
        return { ...m, paid: finance.roundMoney(paid), remaining: finance.roundMoney(m.earned - paid) };
      }),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidOn: p.paidOn,
        periodMonth: p.periodMonth,
        note: p.note,
      })),
    };
  });
