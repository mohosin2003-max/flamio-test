import { useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart";
import {
  comboPricing,
  comboSelectionErrors,
  distributeComboPrices,
  groupRequirementLabel,
  type ComboDto,
  type ComboSelection,
} from "@/lib/combos";
import { formatBDT } from "@/lib/format";
import { primaryImage } from "@/lib/menu-repository";
import { cn } from "@/lib/utils";
import type { CartLine, Product } from "@/types/menu";

type Chosen = { groupId: string; productId: string; variantId: string | null };

function variantsOf(product: Product) {
  return product.variants.filter((v) => v.isAvailable).sort((a, b) => a.price - b.price);
}

function priceOf(product: Product, variantId: string | null): number {
  const variant = product.variants.find((v) => v.id === variantId);
  return variant ? variant.price : product.basePrice;
}

/**
 * Builds one combo from the owner's steps. Every price shown comes from the
 * live menu, and the same maths runs again on the server before the order is
 * accepted.
 */
export function ComboBuilder({ combo, products }: { combo: ComboDto; products: Product[] }) {
  const { addComboLines } = useCart();
  const [chosen, setChosen] = useState<Chosen[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const selections = useMemo<ComboSelection[]>(
    () =>
      chosen.flatMap((c) => {
        const product = productById.get(c.productId);
        if (!product || !product.isAvailable) return [];
        const variant = product.variants.find((v) => v.id === c.variantId) ?? null;
        return [
          {
            groupId: c.groupId,
            productId: product.id,
            productSlug: product.slug,
            productName: product.name,
            variantId: variant?.id ?? null,
            variantName: variant?.name ?? null,
            unitPrice: variant?.price ?? product.basePrice,
            imageUrl: primaryImage(product),
          },
        ];
      }),
    [chosen, productById],
  );

  const pricing = comboPricing(combo, selections);
  const errors = comboSelectionErrors(combo, selections);
  const canAdd = errors.length === 0;

  const toggle = (groupId: string, product: Product, maxSelect: number) => {
    const variantId = variantsOf(product)[0]?.id ?? null;
    setChosen((current) => {
      const already = current.find(
        (c) => c.groupId === groupId && c.productId === product.id,
      );
      if (already) return current.filter((c) => c !== already);
      const inGroup = current.filter((c) => c.groupId === groupId);
      const next = { groupId, productId: product.id, variantId };
      if (maxSelect === 1) {
        return [...current.filter((c) => c.groupId !== groupId), next];
      }
      if (inGroup.length >= maxSelect) {
        toast.info(`You can choose at most ${maxSelect} here.`);
        return current;
      }
      return [...current, next];
    });
  };

  const setVariant = (groupId: string, productId: string, variantId: string) =>
    setChosen((current) =>
      current.map((c) =>
        c.groupId === groupId && c.productId === productId ? { ...c, variantId } : c,
      ),
    );

  const addToCart = () => {
    if (!canAdd) {
      toast.error(errors[0]);
      return;
    }
    const comboKey = `${combo.id}-${Date.now().toString(36)}`;
    const prices = distributeComboPrices(pricing.total, selections);
    const lines: CartLine[] = selections.map((s, index) => ({
      // The step id keeps every line unique when the same item is eligible in
      // (and chosen from) more than one step.
      lineId: `${comboKey}::${s.groupId}::${s.productId}::${s.variantId ?? "base"}`,
      productId: s.productId,
      productName: s.productName,
      productSlug: s.productSlug,
      variantId: s.variantId,
      variantName: s.variantName,
      unitPrice: prices[index] ?? s.unitPrice,
      quantity: 1,
      imageUrl: s.imageUrl,
      comboId: combo.id,
      comboName: combo.name,
      comboKey,
      comboGroupId: s.groupId,
    }));
    addComboLines(lines);
    setChosen([]);
    toast.success(`${combo.name} added to cart`);
  };

  return (
    <article className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
      {combo.imageUrl ? (
        <img
          src={combo.imageUrl}
          alt={combo.name}
          loading="lazy"
          className="h-40 w-full object-cover sm:h-52"
        />
      ) : null}
      <header className="border-b border-border/70 p-4 sm:p-5">
        <h2 className="font-display text-xl font-extrabold">{combo.name}</h2>
        {combo.description ? (
          <p className="mt-1 text-sm text-muted-foreground">{combo.description}</p>
        ) : null}
        {combo.pricingMode === "fixed" && combo.fixedPrice !== null ? (
          <p className="mt-2 text-sm font-semibold text-primary">
            Combo price {formatBDT(combo.fixedPrice)}
          </p>
        ) : null}
      </header>


      <div className="divide-y divide-border/70">
        {combo.groups.map((group) => {
          const options = group.productIds
            .map((id) => productById.get(id))
            .filter((p): p is Product => Boolean(p) && p!.isAvailable);
          const chosenHere = chosen.filter((c) => c.groupId === group.id);

          return (
            <section key={group.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold">
                  {group.name}
                  {group.isRequired ? (
                    <span className="ml-2 text-xs font-bold uppercase tracking-wide text-primary">
                      Required
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Optional
                    </span>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {groupRequirementLabel(group)}
                  {group.extraCharge > 0 ? ` · +${formatBDT(group.extraCharge)}` : ""}
                </p>
              </div>

              {options.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing available in this step right now.
                </p>
              ) : (
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {options.map((product) => {
                    const pick = chosenHere.find((c) => c.productId === product.id);
                    const active = Boolean(pick);
                    const variants = variantsOf(product);
                    return (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => toggle(group.id, product, group.maxSelect)}
                          aria-pressed={active}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-smooth",
                            active
                              ? "border-primary bg-primary/5"
                              : "border-border/70 hover:border-primary/50",
                          )}
                        >
                          {primaryImage(product) ? (
                            <img
                              src={primaryImage(product) as string}
                              alt={product.name}
                              loading="lazy"
                              className="size-12 shrink-0 rounded-lg object-cover"
                            />
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">
                              {product.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {variants.length > 0 ? "from " : ""}
                              {formatBDT(priceOf(product, pick?.variantId ?? variants[0]?.id ?? null))}
                            </span>
                          </span>
                          {active ? (
                            <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                          ) : (
                            <Plus
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                        </button>

                        {active && variants.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2 pl-2">
                            {variants.map((variant) => (
                              <button
                                key={variant.id}
                                type="button"
                                onClick={() => setVariant(group.id, product.id, variant.id)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-xs font-medium transition-smooth",
                                  pick?.variantId === variant.id
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border/70 hover:border-primary/50",
                                )}
                              >
                                {variant.name} · {formatBDT(variant.price)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="border-t border-border/70 bg-muted/30 p-4 sm:p-5">
        <h3 className="text-sm font-semibold">Your combo</h3>
        {selections.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">Nothing chosen yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {selections.map((s) => (
              <li
                key={`${s.groupId}-${s.productId}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="min-w-0 truncate">
                  {s.productName}
                  {s.variantName ? ` (${s.variantName})` : ""}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-muted-foreground">{formatBDT(s.unitPrice)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Remove ${s.productName}`}
                    onClick={() =>
                      setChosen((current) =>
                        current.filter(
                          (c) => !(c.groupId === s.groupId && c.productId === s.productId),
                        ),
                      )
                    }
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {pricing.extras > 0 ? (
          <p className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Extra charges</span>
            <span>{formatBDT(pricing.extras)}</span>
          </p>
        ) : null}

        <p className="mt-3 flex items-baseline justify-between border-t border-border/70 pt-3">
          <span className="text-sm font-semibold">Combo total</span>
          <span className="font-display text-2xl font-extrabold text-gradient-ember">
            {formatBDT(pricing.total)}
          </span>
        </p>
        {pricing.savings > 0 ? (
          <p className="mt-1 text-right text-sm font-semibold text-primary">
            You save {formatBDT(pricing.savings)}
          </p>
        ) : null}

        {errors.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
            {errors.map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="lg" className="flex-1 shadow-ember" disabled={!canAdd} onClick={addToCart}>
            {canAdd ? `Add combo · ${formatBDT(pricing.total)}` : "Complete required steps"}
          </Button>
          {selections.length > 0 ? (
            <Button variant="ghost" size="lg" onClick={() => setChosen([])}>
              Reset
            </Button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
