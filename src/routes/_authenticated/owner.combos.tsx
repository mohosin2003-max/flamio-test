import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ownerDeleteCombo,
  ownerListCombos,
  ownerSaveCombo,
  ownerSetComboActive,
} from "@/lib/combos.functions";
import { formatBDT } from "@/lib/format";
import { menuQueryOptions } from "@/lib/menu-repository";

export const Route = createFileRoute("/_authenticated/owner/combos")({
  head: () => ({
    meta: [
      { title: "Combo Offers — Flamio Owner Dashboard" },
      { name: "description", content: "Create and manage Flamio combo offers." },
      { property: "og:title", content: "Combo Offers — Flamio Owner Dashboard" },
      { property: "og:description", content: "Create and manage Flamio combo offers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(menuQueryOptions());
  },
  component: OwnerCombos,
});

type GroupForm = {
  id: string | null;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  extraCharge: number;
  categoryIds: string[];
  productIds: string[];
  sortOrder: number;
};

type ComboForm = {
  id: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  pricingMode: "calculated" | "fixed";
  fixedPrice: number | null;
  isActive: boolean;
  sortOrder: number;
  groups: GroupForm[];
};

type ComboRow = ComboForm & { problems: string[] };

const emptyCombo: ComboForm = {
  id: null,
  name: "",
  description: null,
  imageUrl: null,
  pricingMode: "calculated",
  fixedPrice: null,
  isActive: false,
  sortOrder: 0,
  groups: [],
};

function OwnerCombos() {
  const { data: menu } = useSuspenseQuery(menuQueryOptions());
  const list = useServerFn(ownerListCombos);
  const save = useServerFn(ownerSaveCombo);
  const setActive = useServerFn(ownerSetComboActive);
  const remove = useServerFn(ownerDeleteCombo);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ComboForm | null>(null);
  const [saving, setSaving] = useState(false);

  const combos = useQuery<ComboRow[]>({
    queryKey: ["owner-combos"],
    queryFn: () => list() as Promise<ComboRow[]>,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-combos"] });

  if (combos.isLoading) return <Skeleton className="h-64 w-full" />;
  if (combos.error) {
    return (
      <EmptyState
        title="Couldn't load combos"
        description="Please try again."
        action={<Button onClick={() => void combos.refetch()}>Retry</Button>}
      />
    );
  }

  const rows = combos.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Combo offers</h2>
          <p className="text-sm text-muted-foreground">
            Build combos from the menu items you already have. Nothing is duplicated.
          </p>
        </div>
        <Button onClick={() => setEditing({ ...emptyCombo, sortOrder: rows.length })}>
          <Plus className="mr-2 h-4 w-4" /> New combo
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No combos yet"
          description="Create your first combo, for example: 1 burger + 1 side + 1 drink."
        />
      ) : (
        <div className="space-y-3">
          {rows.map((combo) => (
            <Card key={combo.id ?? combo.name}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{combo.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {combo.groups.length} step{combo.groups.length === 1 ? "" : "s"} ·{" "}
                      {combo.pricingMode === "fixed" && combo.fixedPrice !== null
                        ? `Fixed ${formatBDT(combo.fixedPrice)}`
                        : "Item prices added up"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {combo.isActive ? "Live" : "Draft"}
                    </span>
                    <Switch
                      checked={combo.isActive}
                      aria-label={`Switch ${combo.name} on or off`}
                      onCheckedChange={async (checked) => {
                        try {
                          await setActive({
                            data: { id: combo.id as string, isActive: checked },
                          });
                          await refresh();
                          toast.success(checked ? "Combo is live" : "Combo switched off");
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Couldn't change this combo",
                          );
                        }
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => setEditing(combo)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${combo.name}`}
                      onClick={async () => {
                        if (!window.confirm(`Remove the combo "${combo.name}"?`)) return;
                        try {
                          await remove({ data: { id: combo.id as string } });
                          await refresh();
                          toast.success("Combo removed");
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Couldn't remove this combo",
                          );
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {combo.problems.length > 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/40 p-3 text-sm">
                    <p className="font-medium">Needs fixing before it can go live:</p>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground">
                      {combo.problems.map((p) => (
                        <li key={p}>• {p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit combo" : "New combo"}</DialogTitle>
          </DialogHeader>

          {editing ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="combo-name">Combo name</Label>
                  <Input
                    id="combo-name"
                    value={editing.name}
                    maxLength={80}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="combo-order">Display order</Label>
                  <Input
                    id="combo-order"
                    type="number"
                    min={0}
                    value={editing.sortOrder}
                    onChange={(e) =>
                      setEditing({ ...editing, sortOrder: Number(e.target.value) || 0 })
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="combo-desc">Description</Label>
                <Textarea
                  id="combo-desc"
                  value={editing.description ?? ""}
                  maxLength={400}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value || null })
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="combo-image">Combo picture link (optional)</Label>
                <Input
                  id="combo-image"
                  placeholder="https://…"
                  value={editing.imageUrl ?? ""}
                  maxLength={600}
                  onChange={(e) => setEditing({ ...editing, imageUrl: e.target.value || null })}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to show no picture. Same kind of image link as the menu items.
                </p>
                {editing.imageUrl ? (
                  <img
                    src={editing.imageUrl}
                    alt="Combo picture preview"
                    className="mt-2 h-28 w-full rounded-lg object-cover"
                  />
                ) : null}
              </div>



              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">One fixed combo price</p>
                    <p className="text-xs text-muted-foreground">
                      Off = the chosen items' menu prices are added up.
                    </p>
                  </div>
                  <Switch
                    checked={editing.pricingMode === "fixed"}
                    aria-label="Use one fixed combo price"
                    onCheckedChange={(checked) =>
                      setEditing({
                        ...editing,
                        pricingMode: checked ? "fixed" : "calculated",
                        fixedPrice: checked ? (editing.fixedPrice ?? 0) : null,
                      })
                    }
                  />
                </div>
                {editing.pricingMode === "fixed" ? (
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="combo-price">Fixed price (৳)</Label>
                    <Input
                      id="combo-price"
                      type="number"
                      min={0}
                      value={editing.fixedPrice ?? 0}
                      onChange={(e) =>
                        setEditing({ ...editing, fixedPrice: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Steps</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        groups: [
                          ...editing.groups,
                          {
                            id: null,
                            name: "",
                            isRequired: true,
                            minSelect: 1,
                            maxSelect: 1,
                            extraCharge: 0,
                            categoryIds: [],
                            productIds: [],
                            sortOrder: editing.groups.length,
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add step
                  </Button>
                </div>

                {editing.groups.map((group, index) => {
                  const setGroup = (next: Partial<GroupForm>) =>
                    setEditing({
                      ...editing,
                      groups: editing.groups.map((g, i) => (i === index ? { ...g, ...next } : g)),
                    });

                  return (
                    <div key={index} className="space-y-3 rounded-xl border border-border p-3">
                      <div className="flex items-end gap-2">
                        <div className="flex-1 space-y-1.5">
                          <Label htmlFor={`group-name-${index}`}>Step name</Label>
                          <Input
                            id={`group-name-${index}`}
                            placeholder="Burger"
                            value={group.name}
                            onChange={(e) => setGroup({ name: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove step ${index + 1}`}
                          onClick={() =>
                            setEditing({
                              ...editing,
                              groups: editing.groups.filter((_, i) => i !== index),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`group-min-${index}`}>Minimum</Label>
                          <Input
                            id={`group-min-${index}`}
                            type="number"
                            min={0}
                            max={10}
                            value={group.minSelect}
                            onChange={(e) =>
                              setGroup({ minSelect: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`group-max-${index}`}>Maximum</Label>
                          <Input
                            id={`group-max-${index}`}
                            type="number"
                            min={1}
                            max={10}
                            value={group.maxSelect}
                            onChange={(e) =>
                              setGroup({ maxSelect: Number(e.target.value) || 1 })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`group-extra-${index}`}>Extra charge (৳)</Label>
                          <Input
                            id={`group-extra-${index}`}
                            type="number"
                            min={0}
                            value={group.extraCharge}
                            onChange={(e) =>
                              setGroup({ extraCharge: Number(e.target.value) || 0 })
                            }
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <Label htmlFor={`group-req-${index}`}>Customer must choose from this step</Label>
                        <Switch
                          id={`group-req-${index}`}
                          checked={group.isRequired}
                          onCheckedChange={(checked) => setGroup({ isRequired: checked })}
                        />
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Allowed categories
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {menu.categories.map((category) => (
                            <label key={category.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={group.categoryIds.includes(category.id)}
                                onCheckedChange={(checked) =>
                                  setGroup({
                                    categoryIds: checked
                                      ? [...group.categoryIds, category.id]
                                      : group.categoryIds.filter((id) => id !== category.id),
                                  })
                                }
                              />
                              {category.name}
                            </label>
                          ))}
                        </div>
                      </div>

                      <details>
                        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Or pick specific items ({group.productIds.length} selected)
                        </summary>
                        <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                          {menu.products.map((product) => (
                            <label key={product.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={group.productIds.includes(product.id)}
                                onCheckedChange={(checked) =>
                                  setGroup({
                                    productIds: checked
                                      ? [...group.productIds, product.id]
                                      : group.productIds.filter((id) => id !== product.id),
                                  })
                                }
                              />
                              <span className="truncate">
                                {product.name}
                                {product.isAvailable ? "" : " (sold out)"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </details>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Show this combo to customers</p>
                  <p className="text-xs text-muted-foreground">
                    Anything missing is explained when you save.
                  </p>
                </div>
                <Switch
                  checked={editing.isActive}
                  aria-label="Show this combo to customers"
                  onCheckedChange={(checked) => setEditing({ ...editing, isActive: checked })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!editing) return;
                setSaving(true);
                try {
                  await save({
                    data: {
                      id: editing.id,
                      name: editing.name,
                      description: editing.description,
                      imageUrl: editing.imageUrl,
                      pricingMode: editing.pricingMode,
                      fixedPrice: editing.fixedPrice,
                      isActive: editing.isActive,
                      sortOrder: editing.sortOrder,
                      groups: editing.groups.map((g, index) => ({
                        id: g.id,
                        name: g.name,
                        isRequired: g.isRequired,
                        minSelect: g.minSelect,
                        maxSelect: g.maxSelect,
                        extraCharge: g.extraCharge,
                        categoryIds: g.categoryIds,
                        productIds: g.productIds,
                        sortOrder: index,
                      })),
                    },
                  });
                  await refresh();
                  await queryClient.invalidateQueries({ queryKey: ["combos"] });
                  setEditing(null);
                  toast.success("Combo saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't save this combo");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save combo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
