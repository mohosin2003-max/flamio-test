import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatBDT } from "@/lib/format";
import { placeholderByCategorySlug } from "@/lib/menu-repository";
import {
  ownerDeletePlatform,
  ownerGetPlatformPricing,
  ownerListPlatforms,
  ownerSavePlatform,
} from "@/lib/platforms.functions";
import type { PlatformRow, PricingMode } from "@/lib/platforms.functions";

/**
 * Owner → Platforms. Add / edit an online platform (name, commission, pricing
 * mode) and set platform-specific prices across the FULL existing menu. Normal
 * menu prices are only shown for reference — they are never written here.
 */
export const Route = createFileRoute("/_authenticated/owner/platforms")({
  head: () => ({
    meta: [
      { title: "Online Platforms — Flamio Owner Dashboard" },
      { name: "description", content: "Manage Flamio food delivery platforms and pricing." },
      { property: "og:title", content: "Online Platforms — Flamio Owner Dashboard" },
      { property: "og:description", content: "Manage Flamio food delivery platforms and pricing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerPlatforms,
});

type Draft = {
  id: string | null;
  name: string;
  commissionPercent: string;
  pricingMode: PricingMode;
  isActive: boolean;
};

const emptyDraft: Draft = {
  id: null,
  name: "",
  commissionPercent: "0",
  pricingMode: "normal",
  isActive: true,
};

function OwnerPlatforms() {
  const listPlatforms = useServerFn(ownerListPlatforms);
  const getPricing = useServerFn(ownerGetPlatformPricing);
  const savePlatform = useServerFn(ownerSavePlatform);
  const deletePlatform = useServerFn(ownerDeletePlatform);
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const platforms = useQuery({
    queryKey: ["owner-platforms"],
    queryFn: () => listPlatforms(),
  });

  const pricing = useQuery({
    queryKey: ["owner-platform-pricing", draft?.id ?? "new"],
    queryFn: () => getPricing({ data: { platformId: draft?.id ?? null } }),
    enabled: draft !== null,
  });

  // Seed the editable price list from the saved platform prices, falling back to
  // the current normal menu prices when the platform uses normal pricing.
  useEffect(() => {
    if (!pricing.data || !draft) return;
    const next: Record<string, string> = {};
    for (const product of pricing.data.products) {
      const value =
        product.platformPrice ?? (draft.pricingMode === "normal" ? product.normalPrice : null);
      next[product.id] = value === null ? "" : String(value);
    }
    setPrices(next);
    // Re-seed only when the edited platform changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.data, draft?.id]);

  const categories = pricing.data?.categories ?? [];
  const products = pricing.data?.products ?? [];

  const grouped = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: products.filter((p) => p.categoryId === category.id),
      })),
    [categories, products],
  );

  const configuredCount = Object.values(prices).filter((v) => v.trim() !== "").length;

  const copyNormalPrices = () => {
    const next: Record<string, string> = {};
    for (const product of products) next[product.id] = String(product.normalPrice);
    setPrices(next);
    toast.success("Normal menu prices copied into this platform");
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (name.length < 2) {
      toast.error("Give this platform a name.");
      return;
    }
    const commission = Number(draft.commissionPercent);
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) {
      toast.error("Commission must be between 0 and 100.");
      return;
    }

    const entries: { productId: string; price: number }[] = [];
    for (const product of products) {
      const raw = (prices[product.id] ?? "").trim();
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        toast.error(`Check the price for ${product.name}.`);
        return;
      }
      entries.push({ productId: product.id, price: value });
    }

    setSaving(true);
    try {
      await savePlatform({
        data: {
          id: draft.id,
          name,
          commissionPercent: commission,
          pricingMode: draft.pricingMode,
          prices: entries,
          isActive: draft.isActive,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-platforms"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-platform-pricing"] });
      toast.success(draft.id ? "Platform updated" : "Platform added");
      setDraft(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this platform");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (platform: PlatformRow) => {
    if (!window.confirm(`Remove ${platform.name}? Past sales keep their own records.`)) return;
    try {
      await deletePlatform({ data: { platformId: platform.id } });
      await queryClient.invalidateQueries({ queryKey: ["owner-platforms"] });
      toast.success("Platform removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove this platform");
    }
  };

  if (platforms.isLoading) return <Skeleton className="h-72 w-full" />;

  if (platforms.error) {
    return (
      <EmptyState
        title="Couldn't load platforms"
        description="Please try again."
        action={<Button onClick={() => void platforms.refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      {draft === null ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold">Online platforms</h2>
              <p className="text-sm text-muted-foreground">
                Commission and platform prices for Foodi, Pathao Food and others.
              </p>
            </div>
            <Button onClick={() => setDraft({ ...emptyDraft })}>
              <Plus className="mr-1 h-4 w-4" /> Add platform
            </Button>
          </div>

          {(platforms.data ?? []).length === 0 ? (
            <EmptyState
              title="No platforms yet"
              description="Add a platform to set its commission and its own menu prices."
            />
          ) : (
            <div className="space-y-3">
              {(platforms.data ?? []).map((platform) => (
                <Card key={platform.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="space-y-1">
                      <p className="font-semibold">{platform.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{platform.commissionPercent}% commission</Badge>
                        <Badge variant="outline">
                          {platform.pricingMode === "normal"
                            ? "Normal menu prices"
                            : "Custom platform prices"}
                        </Badge>
                        <span>{platform.pricedItems} items priced</span>
                        {platform.isActive ? null : <Badge variant="outline">Off</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            id: platform.id,
                            name: platform.name,
                            commissionPercent: String(platform.commissionPercent),
                            pricingMode: platform.pricingMode,
                            isActive: platform.isActive,
                          })
                        }
                      >
                        <Pencil className="mr-1 h-4 w-4" /> Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${platform.name}`}
                        onClick={() => void remove(platform)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {draft.id ? "Edit platform" : "Add platform"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="platform-name">Platform name</Label>
                  <Input
                    id="platform-name"
                    placeholder="Foodi, Pathao Food…"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="platform-commission">Commission (%)</Label>
                  <Input
                    id="platform-commission"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    value={draft.commissionPercent}
                    onChange={(e) => setDraft({ ...draft, commissionPercent: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Menu pricing</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={draft.pricingMode === "normal" ? "default" : "outline"}
                    onClick={() => setDraft({ ...draft, pricingMode: "normal" })}
                  >
                    Use normal menu prices
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={draft.pricingMode === "custom" ? "default" : "outline"}
                    onClick={() => setDraft({ ...draft, pricingMode: "custom" })}
                  >
                    Customize platform prices
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {draft.pricingMode === "normal"
                    ? "Prices start from your normal menu prices. You can still change any single item below."
                    : "Set the prices this platform should use. Items left empty can't be sold on this platform."}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Available for sales</p>
                  <p className="text-xs text-muted-foreground">
                    Switch off to hide this platform from the sale screen.
                  </p>
                </div>
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(checked) => setDraft({ ...draft, isActive: checked })}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base">Platform prices</CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{configuredCount} of {products.length} set</Badge>
                <Button size="sm" variant="outline" onClick={copyNormalPrices}>
                  Copy normal prices
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {pricing.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                grouped.map(({ category, items }) =>
                  items.length === 0 ? null : (
                    <div key={category.id} className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {category.name}
                      </p>
                      <div className="space-y-2">
                        {items.map((product) => {
                          const image =
                            product.imageUrl ?? placeholderByCategorySlug[category.slug] ?? null;
                          return (
                            <div
                              key={product.id}
                              className="flex items-center gap-3 rounded-lg border border-border p-2"
                            >
                              {image ? (
                                <img
                                  src={image}
                                  alt={product.name}
                                  className="h-12 w-12 shrink-0 rounded-md object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-muted font-bold text-muted-foreground">
                                  {product.name.charAt(0)}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  Normal {formatBDT(product.normalPrice)}
                                  {product.isAvailable ? "" : " · unavailable"}
                                </p>
                              </div>
                              <Input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                aria-label={`${product.name} platform price`}
                                className="h-10 w-24 shrink-0"
                                placeholder="—"
                                value={prices[product.id] ?? ""}
                                onChange={(e) =>
                                  setPrices((prev) => ({ ...prev, [product.id]: e.target.value }))
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ),
                )
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save platform
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
