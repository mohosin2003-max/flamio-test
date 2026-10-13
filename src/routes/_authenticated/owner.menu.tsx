import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Layers, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { formatBDT } from "@/lib/format";
import {
  ownerDeleteCategory,
  ownerDeleteProduct,
  ownerDeleteVariant,
  ownerGetCatalog,
  ownerSaveCategory,
  ownerSaveProduct,
  ownerSetProductAvailability,
  ownerListVariants,
  ownerSaveVariant,
} from "@/lib/owner.functions";
import type { OwnerCategory, OwnerProduct } from "@/lib/owner.functions";


export const Route = createFileRoute("/_authenticated/owner/menu")({
  head: () => ({
    meta: [
      { title: "Menu Management — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio menu categories, items and options." },
      { property: "og:title", content: "Menu Management — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio menu categories, items and options." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerMenu,
});

type Draft = {
  id: string | null;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  basePrice: string;
  isAvailable: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: string;
  imageUrl: string;
};

const emptyDraft = (categoryId: string): Draft => ({
  id: null,
  categoryId,
  name: "",
  slug: "",
  description: "",
  basePrice: "0",
  isAvailable: true,
  isFeatured: false,
  isPopular: false,
  sortOrder: "0",
  imageUrl: "",
});

const toDraft = (product: OwnerProduct): Draft => ({
  id: product.id,
  categoryId: product.categoryId,
  name: product.name,
  slug: product.slug,
  description: product.description ?? "",
  basePrice: String(product.basePrice),
  isAvailable: product.isAvailable,
  isFeatured: product.isFeatured,
  isPopular: product.isPopular,
  sortOrder: String(product.sortOrder),
  imageUrl: product.imageUrl ?? "",
});

type CatDraft = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  isVisible: boolean;
  sortOrder: string;
};

const emptyCatDraft = (): CatDraft => ({
  id: null,
  name: "",
  slug: "",
  description: "",
  imageUrl: "",
  isVisible: true,
  sortOrder: "0",
});

const toCatDraft = (category: OwnerCategory): CatDraft => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  description: category.description ?? "",
  imageUrl: category.imageUrl ?? "",
  isVisible: category.isVisible,
  sortOrder: String(category.sortOrder),
});

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function OwnerMenu() {
  const getCatalog = useServerFn(ownerGetCatalog);
  const saveProduct = useServerFn(ownerSaveProduct);
  const deleteProduct = useServerFn(ownerDeleteProduct);
  const setAvailability = useServerFn(ownerSetProductAvailability);
  const saveCategory = useServerFn(ownerSaveCategory);
  const deleteCategory = useServerFn(ownerDeleteCategory);
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [catDraft, setCatDraft] = useState<CatDraft | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [deleting, setDeleting] = useState<OwnerCategory | null>(null);
  const [reassignTo, setReassignTo] = useState<string>("");
  const [variantProduct, setVariantProduct] = useState<OwnerProduct | null>(null);

  const catalog = useQuery({
    queryKey: ["owner-catalog"],
    queryFn: () => getCatalog(),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-catalog"] });
    // Customer-facing menu reads the same tables.
    await queryClient.invalidateQueries({ queryKey: ["menu"] });
  };

  if (catalog.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (catalog.error || !catalog.data) {
    return (
      <EmptyState
        title="Couldn't load the menu"
        description="Please try again."
        action={<Button onClick={() => void catalog.refetch()}>Retry</Button>}
      />
    );
  }

  const { categories, products } = catalog.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">Categories</h2>
            <Button size="sm" variant="outline" onClick={() => setCatDraft(emptyCatDraft())}>
              <Plus className="mr-2 h-4 w-4" /> New category
            </Button>
          </div>

          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No categories yet. Add one before creating menu items.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {categories.map((category) => (
                <li key={category.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{category.name}</p>
                    <p className="text-xs text-muted-foreground">
                      /{category.slug} · {category.productCount} item
                      {category.productCount === 1 ? "" : "s"}
                      {category.isVisible ? "" : " · hidden"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${category.name}`}
                      onClick={() => setCatDraft(toCatDraft(category))}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${category.name}`}
                      onClick={() => {
                        setDeleting(category);
                        setReassignTo(categories.find((c) => c.id !== category.id)?.id ?? "");
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!categories.length}
          onClick={() => setDraft(emptyDraft(categories[0]?.id ?? ""))}
        >
          <Plus className="mr-2 h-4 w-4" /> New item
        </Button>
      </div>

      <Dialog open={catDraft !== null} onOpenChange={(open) => (open ? null : setCatDraft(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{catDraft?.id ? "Edit category" : "New category"}</DialogTitle>
          </DialogHeader>

          {catDraft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={catDraft.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setCatDraft({
                      ...catDraft,
                      name,
                      slug: catDraft.id || catDraft.slug ? catDraft.slug : slugify(name),
                    });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Link (slug)</Label>
                <Input
                  value={catDraft.slug}
                  onChange={(e) => setCatDraft({ ...catDraft, slug: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={catDraft.description}
                  onChange={(e) => setCatDraft({ ...catDraft, description: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Image URL (optional)</Label>
                <Input
                  placeholder="https://..."
                  value={catDraft.imageUrl}
                  onChange={(e) => setCatDraft({ ...catDraft, imageUrl: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to remove the image.
                </p>
              </div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="space-y-1.5">
                  <Label>Sort order</Label>
                  <Input
                    inputMode="numeric"
                    value={catDraft.sortOrder}
                    onChange={(e) => setCatDraft({ ...catDraft, sortOrder: e.target.value })}
                  />
                </div>
                <Toggle
                  label="Visible"
                  checked={catDraft.isVisible}
                  onChange={(v) => setCatDraft({ ...catDraft, isVisible: v })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={catSaving}
              onClick={async () => {
                if (!catDraft) return;
                setCatSaving(true);
                try {
                  await saveCategory({
                    data: {
                      id: catDraft.id,
                      name: catDraft.name.trim(),
                      slug: (catDraft.slug.trim() || slugify(catDraft.name)).trim(),
                      description: catDraft.description.trim() || null,
                      imageUrl: catDraft.imageUrl.trim() || null,
                      isVisible: catDraft.isVisible,
                      sortOrder: Number(catDraft.sortOrder) || 0,
                    },
                  });
                  await invalidate();
                  setCatDraft(null);
                  toast.success("Category saved");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Couldn't save this category",
                  );
                } finally {
                  setCatSaving(false);
                }
              }}
            >
              {catSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}</DialogTitle>
          </DialogHeader>

          {deleting && deleting.productCount > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                This category has {deleting.productCount} item
                {deleting.productCount === 1 ? "" : "s"}. Choose where to move them — no items will
                be deleted.
              </p>
              <Select value={reassignTo} onValueChange={setReassignTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Move items to…" />
                </SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.id !== deleting.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              This category is empty and will be removed.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                catSaving || Boolean(deleting && deleting.productCount > 0 && !reassignTo)
              }
              onClick={async () => {
                if (!deleting) return;
                setCatSaving(true);
                try {
                  await deleteCategory({
                    data: {
                      id: deleting.id,
                      reassignTo: deleting.productCount > 0 ? reassignTo : null,
                    },
                  });
                  await invalidate();
                  setDeleting(null);
                  toast.success("Category deleted");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Couldn't delete this category",
                  );
                } finally {
                  setCatSaving(false);
                }
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {categories.map((category) => {
        const items = products.filter((p) => p.categoryId === category.id);
        return (
          <section key={category.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-bold">{category.name}</h2>
              <Badge variant="secondary">{items.length}</Badge>
              {!category.isVisible ? <Badge variant="outline">Hidden</Badge> : null}
            </div>

            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items in this category.</p>
            ) : (
              items.map((product) => (
                <Card key={product.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatBDT(product.basePrice)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={product.isAvailable}
                        onCheckedChange={async (value) => {
                          try {
                            await setAvailability({ data: { id: product.id, isAvailable: value } });
                            await invalidate();
                          } catch {
                            toast.error("Couldn't update availability");
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setVariantProduct(product)}
                      >
                        <Layers className="mr-1 h-4 w-4" />
                        Options
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDraft(toDraft(product))}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={async () => {
                          if (!confirm(`Delete ${product.name}?`)) return;
                          try {
                            await deleteProduct({ data: { id: product.id } });
                            await invalidate();
                            toast.success("Item deleted");
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Couldn't delete this item",
                            );
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        );
      })}

      <Dialog open={draft !== null} onOpenChange={(open) => (open ? null : setDraft(null))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit item" : "New item"}</DialogTitle>
          </DialogHeader>

          {draft ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={draft.categoryId}
                  onValueChange={(value) => setDraft({ ...draft, categoryId: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    setDraft({
                      ...draft,
                      name,
                      slug:
                        draft.id || draft.slug
                          ? draft.slug
                          : name
                              .toLowerCase()
                              .replace(/[^a-z0-9]+/g, "-")
                              .replace(/^-|-$/g, ""),
                    });
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Link (slug)</Label>
                <Input
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Price (BDT)</Label>
                  <Input
                    inputMode="decimal"
                    value={draft.basePrice}
                    onChange={(e) => setDraft({ ...draft, basePrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Sort order</Label>
                  <Input
                    inputMode="numeric"
                    value={draft.sortOrder}
                    onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Image URL (optional)</Label>
                <Input
                  value={draft.imageUrl}
                  placeholder="https://..."
                  onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                />
              </div>

              <div className="flex flex-wrap gap-4">
                <Toggle
                  label="Available"
                  checked={draft.isAvailable}
                  onChange={(v) => setDraft({ ...draft, isAvailable: v })}
                />
                <Toggle
                  label="Featured"
                  checked={draft.isFeatured}
                  onChange={(v) => setDraft({ ...draft, isFeatured: v })}
                />
                <Toggle
                  label="Popular"
                  checked={draft.isPopular}
                  onChange={(v) => setDraft({ ...draft, isPopular: v })}
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving}
              onClick={async () => {
                if (!draft) return;
                setSaving(true);
                try {
                  await saveProduct({
                    data: {
                      id: draft.id,
                      categoryId: draft.categoryId,
                      name: draft.name.trim(),
                      slug: draft.slug.trim(),
                      description: draft.description.trim() || null,
                      basePrice: Number(draft.basePrice) || 0,
                      isAvailable: draft.isAvailable,
                      isFeatured: draft.isFeatured,
                      isPopular: draft.isPopular,
                      sortOrder: Number(draft.sortOrder) || 0,
                      imageUrl: draft.imageUrl.trim() || null,
                    },
                  });
                  await invalidate();
                  setDraft(null);
                  toast.success("Item saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Couldn't save this item");
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

      <VariantDialog
        product={variantProduct}
        onClose={() => setVariantProduct(null)}
        onChanged={invalidate}
      />
    </div>
  );
}

type VariantDraft = { id: string | null; name: string; price: string; isAvailable: boolean };

function VariantDialog({
  product,
  onClose,
  onChanged,
}: {
  product: OwnerProduct | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const listVariants = useServerFn(ownerListVariants);
  const saveVariant = useServerFn(ownerSaveVariant);
  const deleteVariant = useServerFn(ownerDeleteVariant);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<VariantDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const productId = product?.id ?? null;

  const variants = useQuery({
    queryKey: ["owner-variants", productId],
    queryFn: () => listVariants({ data: { productId: productId as string } }),
    enabled: productId !== null,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner-variants", productId] });
    await onChanged();
  };

  return (
    <Dialog
      open={product !== null}
      onOpenChange={(open) => {
        if (!open) {
          setDraft(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Options for {product?.name}</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Sizes or options with their own price (for example Small / Medium / Large). With no
          options, the item keeps its current price of{" "}
          {product ? formatBDT(product.basePrice) : ""}.
        </p>

        {variants.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : variants.error ? (
          <p className="text-sm text-destructive">Couldn&apos;t load the options.</p>
        ) : (variants.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No options yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {(variants.data ?? []).map((variant) => (
              <li key={variant.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{variant.name}</p>
                  <p className="text-sm text-muted-foreground">{formatBDT(variant.price)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={variant.isAvailable}
                    onCheckedChange={async (value) => {
                      try {
                        await saveVariant({
                          data: {
                            id: variant.id,
                            productId: variant.productId,
                            name: variant.name,
                            price: variant.price,
                            isAvailable: value,
                            sortOrder: variant.sortOrder,
                          },
                        });
                        await refresh();
                      } catch {
                        toast.error("Couldn't update this option");
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        id: variant.id,
                        name: variant.name,
                        price: String(variant.price),
                        isAvailable: variant.isAvailable,
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={async () => {
                      if (!confirm(`Delete ${variant.name}?`)) return;
                      try {
                        await deleteVariant({ data: { id: variant.id } });
                        await refresh();
                        toast.success("Option deleted");
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Couldn't delete this option",
                        );
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {draft ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="space-y-1.5">
              <Label>Option name</Label>
              <Input
                value={draft.name}
                placeholder="Medium"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Price (৳)</Label>
              <Input
                inputMode="decimal"
                value={draft.price}
                onChange={(event) => setDraft({ ...draft, price: event.target.value })}
              />
            </div>
            <Toggle
              label="Available"
              checked={draft.isAvailable}
              onChange={(value) => setDraft({ ...draft, isAvailable: value })}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button
                disabled={saving}
                onClick={async () => {
                  if (!product) return;
                  const price = Number(draft.price);
                  if (!draft.name.trim()) {
                    toast.error("Add an option name");
                    return;
                  }
                  if (!Number.isFinite(price) || price < 0) {
                    toast.error("Add a valid price");
                    return;
                  }
                  setSaving(true);
                  try {
                    await saveVariant({
                      data: {
                        id: draft.id,
                        productId: product.id,
                        name: draft.name.trim(),
                        price,
                        isAvailable: draft.isAvailable,
                        sortOrder: (variants.data ?? []).length,
                      },
                    });
                    setDraft(null);
                    await refresh();
                    toast.success("Option saved");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Couldn't save this option",
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save option
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            onClick={() => setDraft({ id: null, name: "", price: "", isAvailable: true })}
          >
            <Plus className="mr-2 h-4 w-4" /> Add option
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}


function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
