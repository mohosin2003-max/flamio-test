import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatBDT } from "@/lib/format";
import { ownerListInventory } from "@/lib/inventory.functions";
import {
  ownerCreateOtherExpense,
  ownerCreatePurchase,
  ownerDeletePurchase,
  ownerListPurchases,
  ownerUpdatePurchase,
  PURCHASE_PAYMENT_METHODS,
  type PurchaseRecord,
} from "@/lib/purchases.functions";
import { ownerListSuppliers } from "@/lib/suppliers.functions";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";

/**
 * Owner → Purchases. Reuses the existing purchases server functions, which
 * raise stock through the existing `apply_stock_change` mechanism. Reports are
 * simple client-side summaries of that same data — no separate expense system.
 */
export const Route = createFileRoute("/_authenticated/owner/purchases")({
  head: () => ({
    meta: [
      { title: "Purchases — Flamio Owner Dashboard" },
      { name: "description", content: "Record Flamio inventory purchases and other expenses." },
      { property: "og:title", content: "Purchases — Flamio Owner Dashboard" },
      { property: "og:description", content: "Record Flamio inventory purchases and other expenses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { date?: string } => typeof search["date"] === "string" ? { date: search["date"] } : {},
  component: OwnerPurchases,
});

const todayIso = () => new Date().toISOString().slice(0, 10);

function OwnerPurchases() {
  const { date } = Route.useSearch();
  const listPurchases = useServerFn(ownerListPurchases);
  const listInventory = useServerFn(ownerListInventory);
  const createPurchase = useServerFn(ownerCreatePurchase);
  const createOther = useServerFn(ownerCreateOtherExpense);
  const listSuppliers = useServerFn(ownerListSuppliers);
  const queryClient = useQueryClient();

  const [saving, setSaving] = useState(false);
  // Purchase type: the existing inventory flow, or a pure expense record.
  const [kind, setKind] = useState<"inventory" | "others">("inventory");
  const [others, setOthers] = useState({
    purchasedOn: todayIso(),
    name: "",
    quantity: "1",
    unitPrice: "0",
    supplierName: "",
    paymentMethod: "",
    note: "",
  });
  const [form, setForm] = useState({
    purchasedOn: todayIso(),
    supplierName: "",
    itemId: "",
    quantity: "1",
    unitPrice: "0",
    paymentMethod: "",
    note: "",
  });

  const purchases = useQuery({
    queryKey: ["owner-purchases"],
    queryFn: () => listPurchases(),
  });
  const inventory = useQuery({
    queryKey: ["owner-inventory"],
    queryFn: () => listInventory(),
    retry: false,
  });
  const suppliers = useQuery({
    queryKey: ["owner-suppliers"],
    queryFn: () => listSuppliers(),
    retry: false,
  });

  const items = inventory.data?.items ?? [];
  const rows = (purchases.data ?? []).filter((row) => !date || row.purchasedOn === date);
  const supplierNames = (suppliers.data ?? []).filter((s) => s.isActive).map((s) => s.name);

  const quantity = Number(form.quantity) || 0;
  const unitPrice = Number(form.unitPrice) || 0;
  const total = Number((quantity * unitPrice).toFixed(2));
  const othersQuantity = Number(others.quantity) || 0;
  const othersUnitPrice = Number(others.unitPrice) || 0;
  const othersSubtotal = Number((othersQuantity * othersUnitPrice).toFixed(2));

  const reports = useMemo(() => {
    const now = new Date();
    const today = todayIso();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = startOfWeek.toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7);

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    const byIngredient = new Map<string, { quantity: number; unit: string; cost: number }>();
    const bySupplier = new Map<string, number>();
    const byMonth = new Map<string, number>();

    for (const row of rows) {
      if (row.purchasedOn === today) todayTotal += row.totalPrice;
      if (row.purchasedOn >= weekStart) weekTotal += row.totalPrice;
      if (row.purchasedOn.slice(0, 7) === monthStart) monthTotal += row.totalPrice;

      if (row.kind === "inventory") {
        const ing = byIngredient.get(row.itemName) ?? { quantity: 0, unit: row.unit, cost: 0 };
        ing.quantity += row.quantity;
        ing.cost += row.totalPrice;
        byIngredient.set(row.itemName, ing);
      }

      const supplierLabel = row.supplierName?.trim() || "No supplier";
      bySupplier.set(supplierLabel, (bySupplier.get(supplierLabel) ?? 0) + row.totalPrice);
      const month = row.purchasedOn.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + row.totalPrice);
    }

    return {
      todayTotal,
      weekTotal,
      monthTotal,
      byIngredient: [...byIngredient.entries()].sort((a, b) => b[1].cost - a[1].cost),
      bySupplier: [...bySupplier.entries()].sort((a, b) => b[1] - a[1]),
      byMonth: [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12),
    };
  }, [rows]);

  if (purchases.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (purchases.error) {
    return (
      <EmptyState
        title="Couldn't load purchases"
        description="Something went wrong loading your purchase records."
        action={<Button onClick={() => void purchases.refetch()}>Try again</Button>}
      />
    );
  }

  const save = async () => {
    if (!form.itemId) {
      toast.error("Choose an ingredient first.");
      return;
    }
    setSaving(true);
    try {
      await createPurchase({
        data: {
          purchasedOn: form.purchasedOn,
          supplierName: form.supplierName.trim(),
          itemId: form.itemId,
          quantity,
          unitPrice,
          paymentMethod: form.paymentMethod || null,
          note: form.note.trim() || null,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-stock-movements"] }),
      ]);
      toast.success("Purchase saved and stock updated");
      setForm({
        purchasedOn: todayIso(),
        supplierName: form.supplierName,
        itemId: "",
        quantity: "1",
        unitPrice: "0",
        paymentMethod: form.paymentMethod,
        note: "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this purchase");
    } finally {
      setSaving(false);
    }
  };

  const saveOther = async () => {
    if (!others.name.trim() || othersQuantity <= 0) {
      toast.error("Name and quantity are required.");
      return;
    }
    setSaving(true);
    try {
      await createOther({
        data: {
          purchasedOn: others.purchasedOn,
          name: others.name.trim(),
          // The form no longer asks for a category; a fixed default satisfies
          // the existing server requirement without touching stored data.
          category: "Other",
          quantity: othersQuantity,
          unitPrice: othersUnitPrice,
          supplierName: others.supplierName.trim() || null,
          paymentMethod: others.paymentMethod || null,
          note: others.note.trim() || null,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-purchases"] });
      toast.success("Expense saved (stock not changed)");
      setOthers({
        purchasedOn: todayIso(),
        name: "",
        quantity: "1",
        unitPrice: "0",
        supplierName: others.supplierName,
        paymentMethod: others.paymentMethod,
        note: "",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this expense");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
        <TabsList className="w-full">
          <TabsTrigger className="flex-1" value="inventory">
            Inventory / Stock
          </TabsTrigger>
          <TabsTrigger className="flex-1" value="others">
            Others
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === "others" ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div>
              <h2 className="font-display text-base font-bold">Record an expense</h2>
              <p className="text-xs text-muted-foreground">
                Saved as an expense only — inventory stock is not changed.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ox-date">Date</Label>
                <Input
                  id="ox-date"
                  type="date"
                  value={others.purchasedOn}
                  onChange={(e) => setOthers({ ...others, purchasedOn: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ox-supplier">Supplier (optional)</Label>
                <Input
                  id="ox-supplier"
                  list="pu-supplier-options"
                  value={others.supplierName}
                  placeholder="Leave empty if not needed"
                  onChange={(e) => setOthers({ ...others, supplierName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ox-name">Name</Label>
                <Input
                  id="ox-name"
                  value={others.name}
                  placeholder="Shop rent, Salt, Electricity bill…"
                  onChange={(e) => setOthers({ ...others, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ox-qty">Quantity</Label>
                  <Input
                    id="ox-qty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={others.quantity}
                    onChange={(e) => setOthers({ ...others, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ox-price">Unit price</Label>
                  <Input
                    id="ox-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={others.unitPrice}
                    onChange={(e) => setOthers({ ...others, unitPrice: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ox-note">Note</Label>
              <Textarea
                id="ox-note"
                rows={2}
                value={others.note}
                onChange={(e) => setOthers({ ...others, note: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment method (optional)</Label>
              <Select
                value={others.paymentMethod || "none"}
                onValueChange={(value) => setOthers({ ...others, paymentMethod: value === "none" ? "" : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not selected</SelectItem>
                  {PURCHASE_PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>{method}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="text-sm text-muted-foreground">Subtotal</span>
              <span className="font-display text-lg font-bold">{formatBDT(othersSubtotal)}</span>
            </div>
            <datalist id="pu-supplier-options">
              {supplierNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>

            <Button disabled={saving} onClick={() => void saveOther()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save expense
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <EmptyState
          title="Add ingredients first"
          description="Purchases raise the stock of an existing ingredient. Add ingredients in Inventory to start recording purchases."
        />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-4">
            <h2 className="font-display text-base font-bold">Record a purchase</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pu-date">Date</Label>
                <Input
                  id="pu-date"
                  type="date"
                  value={form.purchasedOn}
                  onChange={(e) => setForm({ ...form, purchasedOn: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pu-supplier">Supplier (optional)</Label>
                <Input
                  id="pu-supplier"
                  list="pu-supplier-options"
                  value={form.supplierName}
                  placeholder="Leave empty if not needed"
                  onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                />
                <datalist id="pu-supplier-options">
                  {supplierNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Select
                  value={form.itemId}
                  onValueChange={(value) => setForm({ ...form, itemId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an ingredient" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pu-qty">Quantity</Label>
                  <Input
                    id="pu-qty"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pu-price">Unit price</Label>
                  <Input
                    id="pu-price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.unitPrice}
                    onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pu-note">Note (optional)</Label>
              <Textarea
                id="pu-note"
                rows={2}
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Payment method (optional)</Label>
              <Select
                value={form.paymentMethod || "none"}
                onValueChange={(value) => setForm({ ...form, paymentMethod: value === "none" ? "" : value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not selected" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not selected</SelectItem>
                  {PURCHASE_PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>{method}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="text-sm text-muted-foreground">Total cost</span>
              <span className="font-display text-lg font-bold">{formatBDT(total)}</span>
            </div>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save purchase
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Today" value={formatBDT(reports.todayTotal)} />
        <SummaryCard label="This week" value={formatBDT(reports.weekTotal)} />
        <SummaryCard label="This month" value={formatBDT(reports.monthTotal)} />
      </div>

      <PurchaseHistory rows={rows} />

      {rows.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ListCard
            title="Purchased by ingredient"
            rows={reports.byIngredient.map(([name, value]) => [
              `${name} · ${value.quantity} ${value.unit}`,
              formatBDT(value.cost),
            ])}
          />
          <ListCard
            title="Supplier totals"
            rows={reports.bySupplier.map(([name, value]) => [name, formatBDT(value)])}
          />
          <ListCard
            title="Monthly expense"
            rows={reports.byMonth.map(([month, value]) => [month, formatBDT(value)])}
          />
        </div>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 font-display text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ListCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <h3 className="font-display text-sm font-bold">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/** Monday-start week key (YYYY-MM-DD) for a YYYY-MM-DD date string. */
function weekStartOf(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function prettyDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function prettyMonth(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });
}

function prettyWeek(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Grouped purchase history. Read-only view over the same `rows` used by the
 * existing summaries — no extra fetching, no backend changes.
 */
function PurchaseHistory({ rows }: { rows: PurchaseRecord[] }) {
  const [view, setView] = useState<"date" | "week" | "month">("date");
  const [kindFilter, setKindFilter] = useState<"all" | "inventory" | "others">("all");
  const [week, setWeek] = useState<string>("");
  const [month, setMonth] = useState<string>("");

  const weeks = useMemo(
    () => [...new Set(rows.map((r) => weekStartOf(r.purchasedOn)))].sort((a, b) => b.localeCompare(a)),
    [rows],
  );
  const months = useMemo(
    () => [...new Set(rows.map((r) => r.purchasedOn.slice(0, 7)))].sort((a, b) => b.localeCompare(a)),
    [rows],
  );

  const selectedWeek = week || weeks[0] || "";
  const selectedMonth = month || months[0] || "";

  const inPeriod = useMemo(() => {
    if (view === "week") return rows.filter((r) => weekStartOf(r.purchasedOn) === selectedWeek);
    if (view === "month") return rows.filter((r) => r.purchasedOn.slice(0, 7) === selectedMonth);
    return rows;
  }, [rows, view, selectedWeek, selectedMonth]);

  const visible = useMemo(
    () => (kindFilter === "all" ? inPeriod : inPeriod.filter((r) => r.kind === kindFilter)),
    [inPeriod, kindFilter],
  );

  // Spending breakdown for the selected period, before the type filter.
  const totals = useMemo(() => {
    let inventory = 0;
    let others = 0;
    for (const row of inPeriod) {
      if (row.kind === "others") others += row.totalPrice;
      else inventory += row.totalPrice;
    }
    return { inventory, others, total: inventory + others };
  }, [inPeriod]);

  const groups = useMemo(() => {
    const map = new Map<string, PurchaseRecord[]>();
    for (const row of visible) {
      const list = map.get(row.purchasedOn) ?? [];
      list.push(row);
      map.set(row.purchasedOn, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);


  return (
    <div className="space-y-3">
      <h2 className="font-display text-base font-bold">Purchase history</h2>

      {rows.length === 0 ? (
        <EmptyState title="No purchases yet" description="Saved purchases will appear here." />
      ) : (
        <>
          <Tabs value={view} onValueChange={(value) => setView(value as typeof view)}>
            <TabsList className="w-full">
              <TabsTrigger className="flex-1" value="date">
                By date
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="week">
                Weekly
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="month">
                Monthly
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {view === "week" ? (
            <Select value={selectedWeek} onValueChange={setWeek}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a week" />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((value) => (
                  <SelectItem key={value} value={value}>
                    {prettyWeek(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {view === "month" ? (
            <Select value={selectedMonth} onValueChange={setMonth}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a month" />
              </SelectTrigger>
              <SelectContent>
                {months.map((value) => (
                  <SelectItem key={value} value={value}>
                    {prettyMonth(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <Tabs value={kindFilter} onValueChange={(value) => setKindFilter(value as typeof kindFilter)}>
            <TabsList className="w-full">
              <TabsTrigger className="flex-1" value="all">
                All
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="inventory">
                Inventory
              </TabsTrigger>
              <TabsTrigger className="flex-1" value="others">
                Others
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-1.5 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Inventory purchases</span>
              <span className="font-medium">{formatBDT(totals.inventory)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Others expenses</span>
              <span className="font-medium">{formatBDT(totals.others)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
              <span className="text-muted-foreground">Total spending</span>
              <span className="font-display text-base font-bold">{formatBDT(totals.total)}</span>
            </div>
          </div>

          {groups.length === 0 ? (
            <EmptyState
              title="No purchases in this period"
              description="Choose another period to see purchase records."
            />
          ) : (
            <div className="space-y-2">
              {groups.map(([date, dayRows]) => (
                <DateGroup key={date} date={date} rows={dayRows} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DateGroup({ date, rows }: { date: string; rows: PurchaseRecord[] }) {
  const [open, setOpen] = useState(false);
  const dayTotal = rows.reduce((sum, r) => sum + r.totalPrice, 0);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 p-4 text-left">
          <span className="flex min-w-0 items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{prettyDate(date)}</span>
              <span className="block text-xs text-muted-foreground">
                {rows.length} purchase{rows.length === 1 ? "" : "s"}
              </span>
            </span>
          </span>
          <span className="font-semibold">{formatBDT(dayTotal)}</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 border-t border-border px-4 py-3">
            {rows.map((row) => (
              <div key={row.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.itemName}
                    {row.kind === "others" ? (
                      <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        Others
                      </span>
                    ) : null}
                  </p>
                  {row.kind === "others" ? (
                    <>
                      <p className="text-muted-foreground">
                        {row.category}
                        {row.quantity > 0 ? ` · ${row.quantity} ${row.unit}`.trimEnd() : ""}
                        {row.supplierName?.trim() ? ` · ${row.supplierName.trim()}` : ""}
                        {row.paymentMethod ? ` · ${row.paymentMethod}` : ""}
                      </p>
                      {row.note ? (
                        <p className="text-xs text-muted-foreground">{row.note}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      {row.supplierName?.trim() || "No supplier"} · {row.quantity} {row.unit} ×{" "}
                      {formatBDT(row.unitPrice)}
                    </p>
                  )}
                </div>
                <span className="font-semibold">{formatBDT(row.totalPrice)}</span>
                <PurchaseRowActions row={row} />
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** Owner/Admin-only edit & delete for one purchase row. Stock is corrected server-side. */
function PurchaseRowActions({ row }: { row: PurchaseRecord }) {
  const { isManager } = useDashboardAccess();
  const updatePurchase = useServerFn(ownerUpdatePurchase);
  const deletePurchase = useServerFn(ownerDeletePurchase);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOthers = row.kind === "others";
  const [draft, setDraft] = useState({
    purchasedOn: row.purchasedOn,
    quantity: String(row.quantity),
    price: String(isOthers ? row.totalPrice : row.unitPrice),
    note: row.note ?? "",
  });

  if (!isManager) return null;

  const refresh = () => queryClient.invalidateQueries();

  const save = async () => {
    const quantity = Number(draft.quantity || 0);
    const price = Number(draft.price || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity < 0 || price < 0) {
      toast.error("Enter valid numbers.");
      return;
    }
    setBusy(true);
    try {
      await updatePurchase({ data: { id: row.id, purchasedOn: draft.purchasedOn, quantity, price, note: draft.note } });
      toast.success("Purchase updated");
      setEditing(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this purchase.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(isOthers ? "Delete this expense?" : "Delete this purchase? Its stock will be removed from inventory.")) return;
    setBusy(true);
    try {
      await deletePurchase({ data: { id: row.id } });
      toast.success("Purchase deleted");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete this purchase.");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex w-full justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</Button>
        <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={remove}>Delete</Button>
      </div>
    );
  }

  return (
    <div className="grid w-full gap-2 rounded-md border border-border p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`pd-${row.id}`}>Date</Label>
        <Input id={`pd-${row.id}`} type="date" value={draft.purchasedOn} onChange={(e) => setDraft({ ...draft, purchasedOn: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pq-${row.id}`}>Quantity{row.unit ? ` (${row.unit})` : ""}</Label>
        <Input id={`pq-${row.id}`} type="number" min="0" step="any" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pp-${row.id}`}>{isOthers ? "Amount" : "Unit price"}</Label>
        <Input id={`pp-${row.id}`} type="number" min="0" step="any" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`pn-${row.id}`}>Note</Label>
        <Input id={`pn-${row.id}`} value={draft.note} maxLength={500} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save</Button>
      </div>
    </div>
  );
}
