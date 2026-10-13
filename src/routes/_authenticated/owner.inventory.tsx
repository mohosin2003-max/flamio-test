import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
import { ownerGetCatalog } from "@/lib/owner.functions";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import {
  UNITS,
  ownerAdjustStock,
  ownerListInventory,
  ownerListStockMovements,
  ownerRemoveInventoryItem,
  ownerSaveInventoryItem,
  ownerSaveRecipe,
  recordWaste,
} from "@/lib/inventory.functions";
import type { InventoryItem } from "@/lib/inventory.functions";

export const Route = createFileRoute("/_authenticated/owner/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Flamio Owner Dashboard" },
      { name: "description", content: "Track Flamio stock, ingredients and recipes." },
      { property: "og:title", content: "Inventory — Flamio Owner Dashboard" },
      { property: "og:description", content: "Track Flamio stock, ingredients and recipes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerInventory,
});

type ItemDraft = {
  id: string | null;
  name: string;
  unit: string;
  lowStockThreshold: string;
  unitCost: string;
  isActive: boolean;
  initialStock: string;
};

const emptyItemDraft = (): ItemDraft => ({
  id: null,
  name: "",
  unit: "pcs",
  lowStockThreshold: "0",
  unitCost: "",
  isActive: true,
  initialStock: "0",
});

const toItemDraft = (item: InventoryItem): ItemDraft => ({
  id: item.id,
  name: item.name,
  unit: item.unit,
  lowStockThreshold: String(item.lowStockThreshold),
  unitCost: item.unitCost === null ? "" : String(item.unitCost),
  isActive: item.isActive,
  initialStock: "0",
});

type StockDraft = {
  item: InventoryItem;
  changeType: "add" | "reduce" | "update";
  quantity: string;
  note: string;
};

type WasteDraft = { itemId: string; quantity: string; reason: string; note: string };

function OwnerInventory() {
  const listInventory = useServerFn(ownerListInventory);
  const getCatalog = useServerFn(ownerGetCatalog);
  const saveItem = useServerFn(ownerSaveInventoryItem);
  const removeItem = useServerFn(ownerRemoveInventoryItem);
  const adjustStock = useServerFn(ownerAdjustStock);
  const recordWasteFn = useServerFn(recordWaste);
  const saveRecipe = useServerFn(ownerSaveRecipe);
  const queryClient = useQueryClient();
  const { isManager } = useDashboardAccess();

  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [stockDraft, setStockDraft] = useState<StockDraft | null>(null);
  const [wasteDraft, setWasteDraft] = useState<WasteDraft | null>(null);
  const [recipeProductId, setRecipeProductId] = useState<string | null>(null);
  const [recipeLines, setRecipeLines] = useState<{ itemId: string; quantity: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const inventory = useQuery({
    queryKey: ["owner-inventory"],
    queryFn: () => listInventory(),
  });
  const catalog = useQuery({
    queryKey: ["owner-catalog"],
    queryFn: () => getCatalog(),
  });
  const listMovements = useServerFn(ownerListStockMovements);
  const movements = useQuery({
    queryKey: ["owner-stock-movements"],
    queryFn: () => listMovements(),
  });

  /** Ingredient usage over the last 7 days, from the existing movements data. */
  const usageSummary = useMemo(() => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const totals = new Map<string, { itemId: string; itemName: string; unit: string; used: number }>();
    for (const m of movements.data ?? []) {
      if (m.changeType !== "order" && m.changeType !== "reduce") continue;
      if (new Date(m.createdAt).getTime() < since) continue;
      const entry =
        totals.get(m.itemId) ?? { itemId: m.itemId, itemName: m.itemName, unit: m.unit, used: 0 };
      entry.used += m.quantity;
      totals.set(m.itemId, entry);
    }
    return [...totals.values()].sort((a, b) => b.used - a.used);
  }, [movements.data]);

  const products = catalog.data?.products ?? [];
  const items = inventory.data?.items ?? [];
  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-inventory"] });
    await queryClient.invalidateQueries({ queryKey: ["owner-stock-movements"] });
  };

  const openRecipe = (productId: string) => {
    const lines = (inventory.data?.recipes ?? [])
      .filter((r) => r.productId === productId)
      .map((r) => ({ itemId: r.itemId, quantity: String(r.quantity) }));
    setRecipeLines(lines.length > 0 ? lines : []);
    setRecipeProductId(productId);
  };

  if (inventory.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (inventory.error) {
    return (
      <EmptyState
        title="Couldn't load inventory"
        description="Something went wrong loading your stock."
        action={<Button onClick={() => void inventory.refetch()}>Try again</Button>}
      />
    );
  }

  const lowStockCount = inventory.data?.lowStockCount ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          {lowStockCount > 0 ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {lowStockCount} low stock
            </Badge>
          ) : (
            <span className="text-muted-foreground">All items above threshold</span>
          )}
        </div>
        <Button size="sm" onClick={() => setItemDraft(emptyItemDraft())}>
          <Plus className="mr-1.5 h-4 w-4" />
          New item
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No inventory items yet"
          description="Add ingredients like Bun, Chicken or Cheese to start tracking stock."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.name}</span>
                    {item.isLow ? (
                      <Badge variant="destructive" className="text-[10px]">
                        LOW STOCK
                      </Badge>
                    ) : null}
                    {!item.isActive ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Disabled
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.currentStock} {item.unit} · alert at {item.lowStockThreshold} {item.unit}
                    {item.unitCost !== null ? ` · cost ${item.unitCost}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {isManager ? (
                    <>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Add stock to ${item.name}`}
                        onClick={() =>
                          setStockDraft({ item, changeType: "add", quantity: "1", note: "" })
                        }
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="outline"
                        aria-label={`Reduce stock of ${item.name}`}
                        onClick={() =>
                          setStockDraft({ item, changeType: "reduce", quantity: "1", note: "" })
                        }
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label={`Record waste for ${item.name}`}
                    onClick={() =>
                      setWasteDraft({ itemId: item.id, quantity: "", reason: "", note: "" })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  {isManager ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${item.name}`}
                      onClick={() => setItemDraft(toItemDraft(item))}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">Menu item ingredients</h2>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add menu items first.</p>
        ) : (
          <div className="space-y-2">
            {products.map((product) => {
              const lines = (inventory.data?.recipes ?? []).filter(
                (r) => r.productId === product.id,
              );
              return (
                <Card key={product.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="font-semibold">{product.name}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {lines.length === 0
                          ? "No ingredients linked"
                          : lines
                              .map((l) => {
                                const item = itemsById.get(l.itemId);
                                return item ? `${item.name} ${l.quantity} ${item.unit}` : null;
                              })
                              .filter(Boolean)
                              .join(" · ")}
                      </p>
                    </div>
                    {isManager ? (
                      <Button size="sm" variant="outline" onClick={() => openRecipe(product.id)}>
                        Manage
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">Usage summary (last 7 days)</h2>
        {usageSummary.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ingredient usage recorded yet.</p>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {usageSummary.map((row) => (
                <div key={row.itemId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 text-sm font-medium">{row.itemName}</span>
                  <span className="text-sm text-muted-foreground">
                    {row.used} {row.unit} used
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">Stock history</h2>
        {movements.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : movements.error ? (
          <EmptyState
            title="Couldn't load stock history"
            description="Please try again."
            action={<Button onClick={() => void movements.refetch()}>Try again</Button>}
          />
        ) : (movements.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No stock changes recorded yet.</p>
        ) : (
          <Card>
            <CardContent className="divide-y divide-border p-0">
              {(movements.data ?? []).slice(0, 50).map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{m.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString()} · {m.changeType} · {m.createdByName}
                      {m.note ? ` · ${m.note}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">
                      {m.changeType === "order" || m.changeType === "reduce" || m.changeType === "waste" ? "−" : "+"}
                      {m.quantity} {m.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      left {m.resultingStock} {m.unit}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Item add / edit */}
      <Dialog open={itemDraft !== null} onOpenChange={(open) => !open && setItemDraft(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{itemDraft?.id ? "Edit item" : "New inventory item"}</DialogTitle>
          </DialogHeader>
          {itemDraft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="inv-name">Name</Label>
                <Input
                  id="inv-name"
                  value={itemDraft.name}
                  onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Unit</Label>
                  <Select
                    value={itemDraft.unit}
                    onValueChange={(unit) => setItemDraft({ ...itemDraft, unit })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="inv-threshold">Low-stock alert at</Label>
                  <Input
                    id="inv-threshold"
                    inputMode="decimal"
                    value={itemDraft.lowStockThreshold}
                    onChange={(e) =>
                      setItemDraft({ ...itemDraft, lowStockThreshold: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="inv-cost">Cost per unit (optional)</Label>
                  <Input
                    id="inv-cost"
                    inputMode="decimal"
                    value={itemDraft.unitCost}
                    onChange={(e) => setItemDraft({ ...itemDraft, unitCost: e.target.value })}
                  />
                </div>
                {!itemDraft.id && isManager ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="inv-stock">Starting stock</Label>
                    <Input
                      id="inv-stock"
                      inputMode="decimal"
                      value={itemDraft.initialStock}
                      onChange={(e) =>
                        setItemDraft({ ...itemDraft, initialStock: e.target.value })
                      }
                    />
                  </div>
                ) : null}
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="inv-active">Active</Label>
                <Switch
                  id="inv-active"
                  checked={itemDraft.isActive}
                  onCheckedChange={(isActive) => setItemDraft({ ...itemDraft, isActive })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            {itemDraft?.id && isManager ? (
              <Button
                variant="destructive"
                disabled={saving}
                onClick={async () => {
                  if (!itemDraft.id) return;
                  if (
                    !window.confirm(
                      "Remove this mistakenly added item? This is allowed only when it has zero stock and no purchase, stock, or recipe history.",
                    )
                  ) {
                    return;
                  }
                  setSaving(true);
                  try {
                    await removeItem({ data: { id: itemDraft.id } });
                    setItemDraft(null);
                    await refresh();
                    toast.success("Inventory item removed");
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : "Couldn't remove item");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Remove
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setItemDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!itemDraft) return;
                const trimmedName = itemDraft.name.trim();
                if (trimmedName.length < 2 || trimmedName.length > 60) {
                  toast.error("Item name must be 2–60 characters.");
                  return;
                }
                if (!itemDraft.unit.trim()) {
                  toast.error("Please choose a unit.");
                  return;
                }
                setSaving(true);
                try {
                  await saveItem({
                    data: {
                      id: itemDraft.id,
                      name: itemDraft.name.trim(),
                      unit: itemDraft.unit,
                      lowStockThreshold: Number(itemDraft.lowStockThreshold) || 0,
                      unitCost:
                        itemDraft.unitCost.trim() === "" ? null : Number(itemDraft.unitCost) || 0,
                      isActive: itemDraft.isActive,
                      initialStock: Number(itemDraft.initialStock) || 0,
                    },
                  });
                  setItemDraft(null);
                  await refresh();
                  toast.success("Inventory item saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't save item");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stock adjustment */}
      <Dialog open={stockDraft !== null} onOpenChange={(open) => !open && setStockDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stockDraft ? `Stock — ${stockDraft.item.name}` : "Stock"}</DialogTitle>
          </DialogHeader>
          {stockDraft ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Current: {stockDraft.item.currentStock} {stockDraft.item.unit}
              </p>
              <div className="space-y-1.5">
                <Label>Change type</Label>
                <Select
                  value={stockDraft.changeType}
                  onValueChange={(v) =>
                    setStockDraft({ ...stockDraft, changeType: v as StockDraft["changeType"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Add stock</SelectItem>
                    <SelectItem value="reduce">Reduce stock</SelectItem>
                    <SelectItem value="update">Correct to exact amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-qty">Quantity ({stockDraft.item.unit})</Label>
                <Input
                  id="stock-qty"
                  inputMode="decimal"
                  value={stockDraft.quantity}
                  onChange={(e) => setStockDraft({ ...stockDraft, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="stock-note">Reason (required)</Label>
                <Input
                  id="stock-note"
                  maxLength={200}
                  value={stockDraft.note}
                  onChange={(e) => setStockDraft({ ...stockDraft, note: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!stockDraft) return;
                if (stockDraft.note.trim().length < 3) {
                  toast.error("Please enter a reason (at least 3 characters).");
                  return;
                }
                setSaving(true);
                try {
                  await adjustStock({
                    data: {
                      itemId: stockDraft.item.id,
                      changeType: stockDraft.changeType,
                      quantity: Number(stockDraft.quantity) || 0,
                      note: stockDraft.note.trim(),
                    },
                  });
                  setStockDraft(null);
                  await refresh();
                  toast.success("Stock updated");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't update stock");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Waste entry */}
      <Dialog open={wasteDraft !== null} onOpenChange={(open) => !open && setWasteDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record waste</DialogTitle>
          </DialogHeader>
          {wasteDraft ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Inventory item</Label>
                <Select
                  value={wasteDraft.itemId}
                  onValueChange={(v) => setWasteDraft({ ...wasteDraft, itemId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select item" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name} ({i.currentStock} {i.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="waste-qty">
                  Waste quantity
                  {itemsById.get(wasteDraft.itemId)
                    ? ` (${itemsById.get(wasteDraft.itemId)!.unit})`
                    : ""}
                </Label>
                <Input
                  id="waste-qty"
                  inputMode="decimal"
                  value={wasteDraft.quantity}
                  onChange={(e) => setWasteDraft({ ...wasteDraft, quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="waste-reason">Waste reason (required)</Label>
                <Input
                  id="waste-reason"
                  maxLength={120}
                  placeholder="e.g. Expired, spoiled, dropped"
                  value={wasteDraft.reason}
                  onChange={(e) => setWasteDraft({ ...wasteDraft, reason: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="waste-note">Note (optional)</Label>
                <Input
                  id="waste-note"
                  maxLength={200}
                  value={wasteDraft.note}
                  onChange={(e) => setWasteDraft({ ...wasteDraft, note: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setWasteDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!wasteDraft) return;
                const item = itemsById.get(wasteDraft.itemId);
                const qty = Number(wasteDraft.quantity);
                if (!item) return void toast.error("Please select an inventory item.");
                if (!(qty > 0)) return void toast.error("Enter a waste quantity above zero.");
                if (qty > item.currentStock)
                  return void toast.error("Waste can't be more than the available stock.");
                if (wasteDraft.reason.trim().length < 3)
                  return void toast.error("Please enter a waste reason (at least 3 characters).");
                setSaving(true);
                try {
                  await recordWasteFn({
                    data: {
                      itemId: item.id,
                      quantity: qty,
                      reason: wasteDraft.reason.trim(),
                      note: wasteDraft.note.trim() || null,
                    },
                  });
                  setWasteDraft(null);
                  await refresh();
                  toast.success("Waste recorded");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't record waste");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save waste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recipe editor */}
      <Dialog
        open={recipeProductId !== null}
        onOpenChange={(open) => !open && setRecipeProductId(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ingredients</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {recipeLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ingredients linked yet.</p>
            ) : null}
            {recipeLines.map((line, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label>Ingredient</Label>
                  <Select
                    value={line.itemId}
                    onValueChange={(itemId) =>
                      setRecipeLines(
                        recipeLines.map((l, i) => (i === index ? { ...l, itemId } : l)),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
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
                <div className="w-24 space-y-1.5">
                  <Label>Qty</Label>
                  <Input
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) =>
                      setRecipeLines(
                        recipeLines.map((l, i) =>
                          i === index ? { ...l, quantity: e.target.value } : l,
                        ),
                      )
                    }
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove ingredient"
                  onClick={() => setRecipeLines(recipeLines.filter((_, i) => i !== index))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={items.length === 0}
              onClick={() =>
                setRecipeLines([...recipeLines, { itemId: items[0]?.id ?? "", quantity: "1" }])
              }
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add ingredient
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecipeProductId(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!recipeProductId) return;
                setSaving(true);
                try {
                  await saveRecipe({
                    data: {
                      productId: recipeProductId,
                      lines: recipeLines
                        .filter((l) => l.itemId && Number(l.quantity) > 0)
                        .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) })),
                    },
                  });
                  setRecipeProductId(null);
                  await refresh();
                  toast.success("Ingredients saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't save ingredients");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
