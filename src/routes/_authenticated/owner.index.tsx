import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import type { LucideIcon } from "lucide-react";
import { Boxes, ChefHat, ClipboardList, Contact, CookingPot, Gift, HandCoins, Images, LayoutGrid, MessageCircle, PackageCheck, ReceiptText, Settings2, ShieldCheck, ShoppingBag, Tags, Truck, Users, UtensilsCrossed, WalletCards } from "lucide-react";

import { PushToggle } from "@/components/notifications/PushToggle";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBDT } from "@/lib/format";
import { hasPermission, type StaffPermission } from "@/lib/permissions";
import { ownerGetDashboardSummary } from "@/lib/dashboard.functions";

export const Route = createFileRoute("/_authenticated/owner/")({
  head: () => ({ meta: [
    { title: "Workspace Home — Flamio" },
    { name: "description", content: "Flamio owner and staff workspace." },
    { property: "og:title", content: "Workspace Home — Flamio" },
    { property: "og:description", content: "Flamio owner and staff workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: OwnerHome,
});

type Module = { to: string; label: string; description: string; icon: LucideIcon; permission: StaffPermission | StaffPermission[]; ownerOnly?: boolean; ownerRoleOnly?: boolean; prominent?: boolean };

const MODULES: Module[] = [
  { to: "/owner/pos", label: "Counter Sale", description: "Create an in-store sale", icon: ReceiptText, permission: "pos", prominent: true },
  { to: "/owner/platform-sale", label: "Platform Sale", description: "Record a platform sale", icon: ShoppingBag, permission: "platform_sales" },
  { to: "/kitchen", label: "Kitchen", description: "Open the live kitchen queue", icon: ChefHat, permission: "kitchen", prominent: true },
  { to: "/owner/orders", label: "Orders", description: "Manage online orders", icon: ClipboardList, permission: ["online_orders", "order_management"], prominent: true },
  { to: "/owner/inbox", label: "Messages", description: "Reply to customers", icon: MessageCircle, permission: "customers", prominent: true },
  { to: "/owner/inventory", label: "Inventory", description: "Stock and ingredients", icon: Boxes, permission: "inventory" },
  { to: "/owner/purchases", label: "Purchases", description: "Record business expenses", icon: PackageCheck, permission: "purchases" },
  { to: "/owner/suppliers", label: "Suppliers", description: "Supplier records", icon: Truck, permission: "suppliers" },
  { to: "/owner/customers", label: "Customers", description: "Customer information", icon: Contact, permission: "customers" },
  { to: "/owner/challenges", label: "Challenges", description: "Games and results", icon: CookingPot, permission: "challenges" },
  { to: "/owner/rewards", label: "Rewards", description: "Points and reward rules", icon: Gift, permission: "rewards" },
  { to: "/owner/delivery", label: "Delivery", description: "Zones and charges", icon: Truck, permission: "delivery" },
  { to: "/owner/riders", label: "Riders", description: "Delivery team", icon: Users, permission: "riders" },
  { to: "/owner/reports", label: "Reports", description: "Sales and performance", icon: LayoutGrid, permission: "reports" },
  { to: "/owner/menu", label: "Menu", description: "Products and availability", icon: UtensilsCrossed, permission: "menu" },
  { to: "/owner/combos", label: "Combos", description: "Meal combinations", icon: UtensilsCrossed, permission: "combos" },
  { to: "/owner/coupons", label: "Coupons", description: "Offers and discounts", icon: Tags, permission: "coupons" },
  { to: "/owner/banners", label: "Banners", description: "Home promotions", icon: Images, permission: "banners" },
  { to: "/owner/reviews", label: "Reviews", description: "Customer feedback", icon: MessageCircle, permission: "reviews" },
  { to: "/owner/platforms", label: "Platforms", description: "Delivery platform sales", icon: HandCoins, permission: "platform_sales" },
  { to: "/owner/staff", label: "Staff", description: "People and permissions", icon: ShieldCheck, permission: "staff" },
  { to: "/owner/staff-accounts", label: "Payroll", description: "Staff salary accounts", icon: WalletCards, permission: "staff_finance", ownerOnly: true },
  { to: "/owner/finance", label: "Owner Finance", description: "Profit, withdrawals and partners", icon: HandCoins, permission: "staff_finance", ownerOnly: true },

  { to: "/owner/settings", label: "Settings", description: "Business configuration", icon: Settings2, permission: "settings" },
  { to: "/owner/data-storage", label: "Data & Storage", description: "Retention, cleanup and files", icon: Settings2, permission: "settings", ownerRoleOnly: true },
];

function OwnerHome() {
  const access = useDashboardAccess();
  const can = (permission: StaffPermission | StaffPermission[]) => (Array.isArray(permission) ? permission : [permission]).some((item) => hasPermission(access.data, item));
  const canSeeOrders = can(["online_orders", "order_management"]);
  const getSummary = useServerFn(ownerGetDashboardSummary);
  const summary = useQuery({ queryKey: ["owner-dashboard-summary"], queryFn: () => getSummary(), enabled: Boolean(access.data), refetchInterval: 30_000 });
  const isOwnerRole = Boolean(access.data?.roles?.includes("owner"));
  const modules = MODULES.filter(
    (module) =>
      can(module.permission) &&
      (!module.ownerOnly || access.data?.isManager) &&
      (!module.ownerRoleOnly || isOwnerRole),
  );
  const s = summary.data;
  const [panel, setPanel] = useState<"stock" | "purchases" | null>(null);

  return (
    <div className="space-y-6">
      <PushToggle />
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Today</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {canSeeOrders || can(["pos", "platform_sales"]) ? <SummaryLink to="/owner/orders" search={{ date: s?.today }} label="Sales" value={formatBDT(s?.todaySales ?? 0)} /> : null}
          {canSeeOrders ? <SummaryLink to="/owner/orders" search={{ activeOnline: true }} label="Active orders" value={String(s?.activeOnlineOrders ?? 0)} /> : null}
          {can("inventory") ? <SummaryLink to="/owner/inventory" label="Low stock" value={String(s?.inventory.lowStock ?? 0)} /> : null}
          {can("purchases") ? <SummaryLink to="/owner/purchases" search={{ date: s?.today }} label="Expenses" value={formatBDT(s?.todayExpenses ?? 0)} /> : null}
        </div>
        {summary.isLoading ? <Skeleton className="mt-3 h-24 w-full" /> : null}
        {(canSeeOrders || can(["pos", "platform_sales"])) && can("purchases") ? (
          <div className="mt-3 rounded-lg border border-primary/40 bg-card p-4 shadow-card">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Today's Profit</p>
            <p className={`mt-1 font-display text-2xl font-black ${(s?.todayProfit ?? 0) < 0 ? "text-destructive" : "text-primary"}`}>{formatBDT(s?.todayProfit ?? 0)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Sales {formatBDT(s?.todaySales ?? 0)} − Expenses {formatBDT(s?.todayExpenses ?? 0)}</p>
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-3">
          {can("inventory") ? <button type="button" onClick={() => setPanel(panel === "stock" ? null : "stock")} className="rounded-lg border border-border bg-card p-3 text-left text-sm font-bold transition-colors hover:bg-muted" aria-expanded={panel === "stock"}>Current Stock</button> : null}
          {can("purchases") ? <button type="button" onClick={() => setPanel(panel === "purchases" ? null : "purchases")} className="rounded-lg border border-border bg-card p-3 text-left text-sm font-bold transition-colors hover:bg-muted" aria-expanded={panel === "purchases"}>Purchase History</button> : null}
        </div>
        {panel === "stock" && can("inventory") ? (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {(s?.stock ?? []).length === 0 ? <li className="p-3 text-muted-foreground">No inventory items yet.</li> : null}
            {(s?.stock ?? []).map((item) => (
              <li key={item.id} className="flex justify-between gap-3 p-3"><span>{item.name}</span><span className={`font-semibold ${item.stock <= 0 ? "text-destructive" : ""}`}>{item.stock.toLocaleString("en-US")} {item.unit}</span></li>
            ))}
          </ul>
        ) : null}
        {panel === "purchases" && can("purchases") ? (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card text-sm">
            {(s?.todayPurchases ?? []).length === 0 ? <li className="p-3 text-muted-foreground">No purchases recorded today.</li> : null}
            {(s?.todayPurchases ?? []).map((row) => (
              <li key={row.id} className="flex justify-between gap-3 p-3">
                <span><span className="block font-semibold">{row.label}</span><span className="text-xs text-muted-foreground">{row.quantity > 0 ? `${row.quantity.toLocaleString("en-US")} ${row.unit} · ` : ""}{new Date(row.at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span></span>
                <span className="font-semibold">{formatBDT(row.amount)}</span>
              </li>
            ))}
            <li className="p-3"><Link to="/owner/purchases" className="text-xs font-semibold text-primary">Open Purchases</Link></li>
          </ul>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-black">Your workspace</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {modules.map((module) => (
            <Link key={module.to} to={module.to as never} className={module.prominent ? "min-h-28 rounded-lg border border-primary/40 bg-card p-4 shadow-ember transition-colors hover:bg-muted" : "min-h-24 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted"}>
              <module.icon className="size-5 text-primary" aria-hidden="true" />
              <span className="mt-3 block font-display font-bold">{module.label}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{module.description}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function SummaryLink({ to, search, label, value }: { to: "/owner/orders" | "/owner/purchases" | "/owner/inventory"; search?: Record<string, string | boolean | undefined>; label: string; value: string }) {
  return <Link to={to} search={search ?? {}} className="rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:bg-muted"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 font-display text-lg font-bold">{value}</p></Link>;
}