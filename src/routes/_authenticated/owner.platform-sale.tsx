import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBDT } from "@/lib/format";
import { placeholderByCategorySlug } from "@/lib/menu-repository";
import {
  ownerGetPlatformPricing,
  ownerListPlatforms,
  ownerPlacePlatformSale,
} from "@/lib/platforms.functions";

/**
 * Owner → Platform sale. A till for orders that arrive through an online
 * platform. It stores a normal order row (so Kitchen, Orders, Reports and
 * inventory work unchanged) plus the commission snapshot. Counter Sale is a
 * separate screen and is not touched.
 */
export const Route = createFileRoute("/_authenticated/owner/platform-sale")({
  head: () => ({
    meta: [
      { title: "Platform Sale — Flamio Owner Dashboard" },
      { name: "description", content: "Record Flamio sales from online food platforms." },
      { property: "og:title", content: "Platform Sale — Flamio Owner Dashboard" },
      { property: "og:description", content: "Record Flamio sales from online food platforms." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PlatformSale,
});

function PlatformSale() {
  const listPlatforms = useServerFn(ownerListPlatforms);
  const getPricing = useServerFn(ownerGetPlatformPricing);
  const placeSale = useServerFn(ownerPlacePlatformSale);
  const queryClient = useQueryClient();

  const [platformId, setPlatformId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, number>>({});
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);

  const platforms = useQuery({
    queryKey: ["owner-platforms"],
    queryFn: () => listPlatforms(),
  });

  const active = (platforms.data ?? []).filter((p) => p.isActive);
  const selectedId = platformId ?? active[0]?.id ?? null;
  const platform = active.find((p) => p.id === selectedId) ?? null;

  const pricing = useQuery({
    queryKey: ["owner-platform-pricing", selectedId ?? "none"],
    queryFn: () => getPricing({ data: { platformId: selectedId } }),
    enabled: selectedId !== null,
  });

  const products = (pricing.data?.products ?? []).filter((p) => p.isAvailable);
  const categories = pricing.data?.categories ?? [];

  const gross = useMemo(
    () =>
      products.reduce(
        (sum, p) => sum + (p.effectivePrice ?? 0) * (lines[p.id] ?? 0),
        0,
      ),
    [products, lines],
  );
  const itemCount = Object.values(lines).reduce((sum, n) => sum + n, 0);
  const commissionRate = platform?.commissionPercent ?? 0;
  const commissionAmount = Math.round(((gross * commissionRate) / 100) * 100) / 100;
  const netReceivable = Math.round((gross - commissionAmount) * 100) / 100;

  const bump = (id: string, delta: number) =>
    setLines((prev) => {
      const next = Math.max((prev[id] ?? 0) + delta, 0);
      const copy = { ...prev };
      if (next === 0) delete copy[id];
      else copy[id] = next;
      return copy;
    });

  const record = async () => {
    if (!selectedId) return;
    const selected = products.filter((p) => (lines[p.id] ?? 0) > 0);
    if (selected.length === 0) {
      toast.error("Add at least one item to the sale.");
      return;
    }
    const missing = selected.find((p) => p.effectivePrice === null);
    if (missing) {
      toast.error(`${missing.name} has no platform price yet. Set it under Platforms first.`);
      return;
    }
    setSaving(true);
    try {
      const result = await placeSale({
        data: {
          platformId: selectedId,
          reference: reference.trim() || null,
          items: selected.map((p) => ({ productId: p.id, quantity: lines[p.id] ?? 1 })),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-inventory"] });
      setLines({});
      setReference("");
      toast.success(
        `Sale saved — ${result.code} · net ${formatBDT(result.netReceivable)} after ${formatBDT(result.commissionAmount)} commission`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't record this sale");
    } finally {
      setSaving(false);
    }
  };

  if (platforms.isLoading) return <Skeleton className="h-96 w-full" />;

  if (active.length === 0) {
    return (
      <EmptyState
        title="No platform set up yet"
        description="Add a platform with its commission and prices, then record sales here."
        action={
          <Button asChild>
            <Link to="/owner/platforms">Set up a platform</Link>
          </Button>
        }
      />
    );
  }

  const visibleCategories = categories.filter((c) =>
    products.some((p) => p.categoryId === c.id),
  );
  const selectedCategory = activeCategory ?? visibleCategories[0]?.id ?? null;
  const visibleProducts = products.filter((p) => p.categoryId === selectedCategory);

  return (
    <div className="space-y-5">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {active.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={p.id === selectedId ? "default" : "outline"}
            className="shrink-0"
            onClick={() => {
              setPlatformId(p.id);
              setLines({});
            }}
          >
            {p.name} · {p.commissionPercent}%
          </Button>
        ))}
      </div>

      {pricing.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {visibleCategories.map((category) => (
              <Button
                key={category.id}
                size="sm"
                variant={category.id === selectedCategory ? "secondary" : "ghost"}
                className="shrink-0"
                onClick={() => setActiveCategory(category.id)}
              >
                {category.name}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleProducts.map((product) => {
              const qty = lines[product.id] ?? 0;
              const categorySlug =
                categories.find((c) => c.id === product.categoryId)?.slug ?? "";
              const imageUrl =
                product.imageUrl ?? placeholderByCategorySlug[categorySlug] ?? null;
              const priced = product.effectivePrice !== null;
              return (
                <Card key={product.id} className="overflow-hidden">
                  <button
                    type="button"
                    className="block w-full text-left disabled:opacity-60"
                    disabled={!priced}
                    aria-label={`Add one ${product.name}`}
                    onClick={() => bump(product.id, 1)}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={product.name}
                        className="aspect-[4/3] w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="grid aspect-[4/3] w-full place-items-center bg-muted text-2xl font-bold text-muted-foreground">
                        {product.name.charAt(0)}
                      </div>
                    )}
                    <div className="space-y-0.5 p-2.5">
                      <p className="truncate text-sm font-semibold">{product.name}</p>
                      {priced ? (
                        <p className="text-sm font-bold text-primary">
                          {formatBDT(product.effectivePrice as number)}
                        </p>
                      ) : (
                        <p className="text-xs font-medium text-muted-foreground">
                          No platform price
                        </p>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
                    {qty > 0 ? (
                      <>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-9 w-9 shrink-0"
                          aria-label={`Remove one ${product.name}`}
                          onClick={() => bump(product.id, -1)}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-semibold">{qty}</span>
                        <Button
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          aria-label={`Add one ${product.name}`}
                          onClick={() => bump(product.id, 1)}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        className="h-9 w-full"
                        disabled={!priced}
                        aria-label={`Add one ${product.name}`}
                        onClick={() => bump(product.id, 1)}
                      >
                        <Plus className="mr-1 h-4 w-4" /> Add
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="platform-ref">Platform order number (optional)</Label>
            <Input
              id="platform-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. 884512"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{itemCount} items</Badge>
                <span className="text-muted-foreground">{platform?.name}</span>
              </span>
              <span className="font-semibold">{formatBDT(gross)}</span>
            </div>
            <div className="flex items-center justify-between text-muted-foreground">
              <span>Commission ({commissionRate}%)</span>
              <span>−{formatBDT(commissionAmount)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="font-medium">Net receivable</span>
              <span className="font-display text-lg font-bold">{formatBDT(netReceivable)}</span>
            </div>
          </div>

          <Button disabled={saving} onClick={() => void record()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save platform sale
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
