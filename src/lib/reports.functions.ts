import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canonicalPhone } from "@/lib/phone";

/**
 * Owner reporting and CRM. Everything here reads the EXISTING orders and
 * order_items rows — no separate analytics store. Owner/admin only, checked
 * server-side with `assertOwner`.
 */

export interface SalesReport {
  from: string;
  to: string;
  orderCount: number;
  cancelledCount: number;
  orderTotal: number;
  paidRevenue: number;
  averageOrderValue: number;
  byDay: { date: string; orders: number; total: number; paid: number }[];
  byPayment: { label: string; orders: number; total: number; paid: number }[];
  byStatus: { status: string; orders: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  topCategories: { name: string; quantity: number; revenue: number }[];
  expenses: number;
  net: number;
}

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Cash orders are only real revenue once the order is completed. */
const isPaid = (status: string) => status === "completed";

export const ownerGetSalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rangeSchema.parse(input))
  .handler(async ({ data, context }): Promise<SalesReport> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "reports", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const fromIso = new Date(`${data.from}T00:00:00+06:00`).toISOString();
    const toIso = new Date(new Date(`${data.to}T00:00:00+06:00`).getTime() + 86_400_000 - 1).toISOString();

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("id, status, total, payment_label, created_at")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("Sales report failed", error);
      throw new Error("We couldn't build this report. Please try again.");
    }

    const rows = orders ?? [];
    const ids = rows.map((o) => o.id);

    const { data: purchaseRows, error: purchaseError } = await supabaseAdmin
      .from("purchases")
      .select("total_price")
      .gte("purchased_on", data.from)
      .lte("purchased_on", data.to)
      .limit(5000);
    if (purchaseError) {
      console.error("Report expenses failed", purchaseError);
      throw new Error("We couldn't build this report. Please try again.");
    }
    const expenses = (purchaseRows ?? []).reduce((sum, row) => sum + Number(row.total_price), 0);

    let items: { order_id: string; product_id: string; product_name: string; quantity: number; unit_price: number }[] =
      [];
    if (ids.length > 0) {
      const { data: itemRows, error: itemsError } = await supabaseAdmin
        .from("order_items")
        .select("order_id, product_id, product_name, quantity, unit_price")
        .in("order_id", ids);
      if (itemsError) {
        console.error("Sales report items failed", itemsError);
      } else {
        items = (itemRows ?? []).map((i) => ({
          order_id: i.order_id,
          product_id: i.product_id,
          product_name: i.product_name,
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
        }));
      }
    }

    const { data: products } = await supabaseAdmin
      .from("products")
      .select("id, categories(name)");
    const categoryByProduct = new Map<string, string>();
    for (const p of products ?? []) {
      const cat = p.categories as { name: string } | null;
      categoryByProduct.set(p.id, cat?.name ?? "Uncategorised");
    }

    let orderTotal = 0;
    let paidRevenue = 0;
    let cancelledCount = 0;
    const byDay = new Map<string, { orders: number; total: number; paid: number }>();
    const byPayment = new Map<string, { orders: number; total: number; paid: number }>();
    const byStatus = new Map<string, number>();

    for (const o of rows) {
      const total = Number(o.total);
      const paid = isPaid(o.status) ? total : 0;
      if (o.status === "cancelled") cancelledCount += 1;
      orderTotal += total;
      paidRevenue += paid;

      const day = o.created_at.slice(0, 10);
      const d = byDay.get(day) ?? { orders: 0, total: 0, paid: 0 };
      byDay.set(day, { orders: d.orders + 1, total: d.total + total, paid: d.paid + paid });

      const p = byPayment.get(o.payment_label) ?? { orders: 0, total: 0, paid: 0 };
      byPayment.set(o.payment_label, {
        orders: p.orders + 1,
        total: p.total + total,
        paid: p.paid + paid,
      });

      byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    }

    const cancelledIds = new Set(rows.filter((o) => o.status === "cancelled").map((o) => o.id));
    const productTotals = new Map<string, { quantity: number; revenue: number }>();
    const categoryTotals = new Map<string, { quantity: number; revenue: number }>();

    for (const i of items) {
      if (cancelledIds.has(i.order_id)) continue;
      const revenue = i.unit_price * i.quantity;
      const p = productTotals.get(i.product_name) ?? { quantity: 0, revenue: 0 };
      productTotals.set(i.product_name, {
        quantity: p.quantity + i.quantity,
        revenue: p.revenue + revenue,
      });
      const catName = categoryByProduct.get(i.product_id) ?? "Uncategorised";
      const c = categoryTotals.get(catName) ?? { quantity: 0, revenue: 0 };
      categoryTotals.set(catName, {
        quantity: c.quantity + i.quantity,
        revenue: c.revenue + revenue,
      });
    }

    const sortTop = (map: Map<string, { quantity: number; revenue: number }>) =>
      [...map.entries()]
        .map(([name, v]) => ({ name, quantity: v.quantity, revenue: Number(v.revenue.toFixed(2)) }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);

    return {
      from: data.from,
      to: data.to,
      orderCount: rows.length,
      cancelledCount,
      orderTotal: Number(orderTotal.toFixed(2)),
      paidRevenue: Number(paidRevenue.toFixed(2)),
      averageOrderValue: rows.length ? Number((orderTotal / rows.length).toFixed(2)) : 0,
      byDay: [...byDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      byPayment: [...byPayment.entries()]
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.total - a.total),
      byStatus: [...byStatus.entries()]
        .map(([status, orders]) => ({ status, orders }))
        .sort((a, b) => b.orders - a.orders),
      topProducts: sortTop(productTotals),
      topCategories: sortTop(categoryTotals),
      expenses: Number(expenses.toFixed(2)),
      net: Number((paidRevenue - expenses).toFixed(2)),
    };
  });

export type CustomerSegment = "new" | "returning" | "frequent" | "inactive";

export interface CrmCustomer {
  key: string;
  name: string;
  /** Partially masked — the full number stays in the order record only. */
  phoneMasked: string;
  orderCount: number;
  totalSpent: number;
  paidSpent: number;
  firstOrderAt: string;
  lastOrderAt: string;
  segment: CustomerSegment;
}

function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 5) return trimmed;
  return `${trimmed.slice(0, 3)}${"•".repeat(Math.max(trimmed.length - 5, 2))}${trimmed.slice(-2)}`;
}

/** Owner CRM built from real order history — no extra customer table. */
export const ownerListCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmCustomer[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("customer_name, customer_phone, total, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("CRM list failed", error);
      throw new Error("We couldn't load customers. Please try again.");
    }

    const map = new Map<string, CrmCustomer>();
    for (const row of data ?? []) {
      // Canonical phone identity so 017…, 8801… and +8801… are one customer.
      const key = canonicalPhone(row.customer_phone) ?? row.customer_phone.trim();
      const total = Number(row.total);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          name: row.customer_name,
          phoneMasked: maskPhone(key),
          orderCount: 1,
          totalSpent: total,
          paidSpent: isPaid(row.status) ? total : 0,
          firstOrderAt: row.created_at,
          lastOrderAt: row.created_at,
          segment: "new",
        });
        continue;
      }
      existing.orderCount += 1;
      existing.totalSpent += total;
      if (isPaid(row.status)) existing.paidSpent += total;
      if (row.created_at < existing.firstOrderAt) existing.firstOrderAt = row.created_at;
      if (row.created_at > existing.lastOrderAt) {
        existing.lastOrderAt = row.created_at;
        existing.name = row.customer_name;
      }
    }

    const now = Date.now();
    const days = (iso: string) => (now - new Date(iso).getTime()) / 86_400_000;

    return [...map.values()]
      .map((c) => ({
        ...c,
        totalSpent: Number(c.totalSpent.toFixed(2)),
        paidSpent: Number(c.paidSpent.toFixed(2)),
        segment: (days(c.lastOrderAt) > 60
          ? "inactive"
          : c.orderCount >= 5
            ? "frequent"
            : c.orderCount > 1
              ? "returning"
              : "new") as CustomerSegment,
      }))
      .sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  });

/**
 * Promotional in-app notification. Reuses the existing `notifications` table
 * the customer bell already reads, so nothing new is needed on the customer
 * side. Only signed-in customers (who have an account) receive it.
 */
export const ownerSendPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        title: z.string().trim().min(3).max(80),
        body: z.string().trim().min(3).max(300),
        segment: z.enum(["all", "new", "returning", "frequent", "inactive"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("user_id, created_at")
      .not("user_id", "is", null)
      .limit(10_000);

    if (error) {
      console.error("Promotion audience failed", error);
      throw new Error("We couldn't work out who to send this to. Please try again.");
    }

    const stats = new Map<string, { count: number; last: string }>();
    for (const row of orders ?? []) {
      const id = row.user_id as string;
      const s = stats.get(id) ?? { count: 0, last: row.created_at };
      s.count += 1;
      if (row.created_at > s.last) s.last = row.created_at;
      stats.set(id, s);
    }

    const now = Date.now();
    const recipients = [...stats.entries()]
      .filter(([, s]) => {
        const days = (now - new Date(s.last).getTime()) / 86_400_000;
        if (data.segment === "all") return true;
        if (data.segment === "inactive") return days > 60;
        if (days > 60) return false;
        if (data.segment === "frequent") return s.count >= 5;
        if (data.segment === "returning") return s.count > 1;
        return s.count === 1;
      })
      .map(([id]) => id);

    if (recipients.length === 0) return { ok: true, sent: 0 };

    // Broadcast stays separate from transactional order notifications: its own
    // `broadcast` kind, and it is only ever sent when the owner presses send.
    const { notifyUsers } = await import("@/lib/push.server");
    await notifyUsers(
      recipients.map((userId) => ({
        userId,
        kind: "broadcast" as const,
        title: data.title,
        body: data.body,
      })),
      {
        title: data.title,
        body: data.body,
        url: "/account/notifications",
        urgency: "normal",
      },
    );

    return { ok: true, sent: recipients.length };
  });
