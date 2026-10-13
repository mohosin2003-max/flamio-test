import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dhakaDateKey, dhakaDayBounds } from "@/lib/dates";
import type { StaffPermission } from "@/lib/permissions";

export type DashboardSummary = {
  today: string;
  todaySales: number;
  todayOrders: number;
  todayCustomers: number;
  todayExpenses: number;
  todayStaffActivity: number;
  activeOnlineOrders: number;
  inventory: { totalItems: number; lowStock: number; outOfStock: number };
  reports: { sales: number; expenses: number; net: number };
  todayProfit: number;
  stock: { id: string; name: string; unit: string; stock: number }[];
  todayPurchases: { id: string; label: string; quantity: number; unit: string; amount: number; at: string }[];
};

export const ownerGetDashboardSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DashboardSummary> => {
    const { getAccessProfile } = await import("@/lib/owner.server");
    const access = await getAccessProfile(context.userId);
    if (!access.isManager && !access.isStaff) throw new Error("Forbidden");
    const can = (permission: StaffPermission) => access.isManager || access.permissions.includes(permission);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = dhakaDateKey();
    const bounds = dhakaDayBounds(today);

    const [todayOrdersResult, allCompletedResult, todayPurchasesResult, allPurchasesResult, inventoryResult, staffResult, activeResult] = await Promise.all([
      can("order_management") || can("online_orders") || can("pos") || can("platform_sales")
        ? supabaseAdmin.from("orders").select("total, status, customer_phone").gte("created_at", bounds.from).lte("created_at", bounds.to)
        : Promise.resolve({ data: [] }),
      can("reports")
        ? supabaseAdmin.from("orders").select("total").eq("status", "completed").lte("created_at", bounds.to).limit(10000)
        : Promise.resolve({ data: [] }),
      can("purchases")
        ? supabaseAdmin.from("purchases").select("id, total_price, quantity, unit_label, expense_name, created_at, inventory_items(name, unit)").eq("purchased_on", today).order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      can("reports")
        ? supabaseAdmin.from("purchases").select("total_price").lte("purchased_on", today).limit(10000)
        : Promise.resolve({ data: [] }),
      can("inventory")
        ? supabaseAdmin.from("inventory_items").select("id, name, unit, current_stock, low_stock_threshold").eq("is_active", true).order("name")
        : Promise.resolve({ data: [] }),
      can("staff_finance")
        ? supabaseAdmin.from("staff_ledger_entries").select("amount").eq("entry_date", today).eq("status", "approved")
        : Promise.resolve({ data: [] }),
      can("online_orders") || can("order_management")
        ? supabaseAdmin.from("orders").select("id").eq("channel", "online").not("status", "in", "(completed,cancelled,scheduled)")
        : Promise.resolve({ data: [] }),
    ]);

    const todayRows = todayOrdersResult.data ?? [];
    const todaySales = todayRows.filter((row) => row.status === "completed").reduce((sum, row) => sum + Number(row.total), 0);
    const todayExpenses = (todayPurchasesResult.data ?? []).reduce((sum, row) => sum + Number(row.total_price), 0);
    const sales = (allCompletedResult.data ?? []).reduce((sum, row) => sum + Number(row.total), 0);
    const expenses = (allPurchasesResult.data ?? []).reduce((sum, row) => sum + Number(row.total_price), 0);
    const inventoryRows = inventoryResult.data ?? [];

    return {
      today,
      todaySales: Number(todaySales.toFixed(2)),
      todayOrders: todayRows.length,
      todayCustomers: new Set(todayRows.map((row) => row.customer_phone).filter(Boolean)).size,
      todayExpenses: Number(todayExpenses.toFixed(2)),
      todayStaffActivity: Number((staffResult.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)),
      activeOnlineOrders: (activeResult.data ?? []).length,
      inventory: {
        totalItems: inventoryRows.length,
        lowStock: inventoryRows.filter((row) => Number(row.current_stock) > 0 && Number(row.current_stock) <= Number(row.low_stock_threshold)).length,
        outOfStock: inventoryRows.filter((row) => Number(row.current_stock) <= 0).length,
      },
      todayProfit: Number((todaySales - todayExpenses).toFixed(2)),
      stock: inventoryRows.map((row) => ({ id: row.id, name: row.name, unit: row.unit, stock: Number(row.current_stock) })),
      todayPurchases: (todayPurchasesResult.data ?? []).map((row) => {
        const item = (row as { inventory_items?: { name: string; unit: string } | null }).inventory_items;
        return { id: row.id, label: item?.name ?? row.expense_name ?? "Expense", quantity: Number(row.quantity), unit: row.unit_label ?? item?.unit ?? "", amount: Number(row.total_price), at: row.created_at };
      }),
      reports: { sales: Number(sales.toFixed(2)), expenses: Number(expenses.toFixed(2)), net: Number((sales - expenses).toFixed(2)) },
    };
  });