/**
 * FLAMIO Burger Boost — reward discount eligibility (PURE, no I/O).
 * Single source of truth for which cart lines a Burger Boost reward may
 * discount and how much. Server code must feed it trusted product records
 * and prices; browser values are display-only. Delivery is never discounted.
 * Mirrored by burger_boost.place_order_with_reward in the SQL draft.
 */

/** Categories whose every product is eligible (public.categories.slug). */
export const ELIGIBLE_CATEGORY_SLUGS = ["burger", "meat-box", "pizza", "pasta"] as const;
/** Mixed category: only these products qualify (fail closed for new sides). */
export const MIXED_CATEGORY_SLUG = "shawarma-and-sides";
export const ELIGIBLE_MIXED_PRODUCT_SLUGS = ["chicken-shawarma"] as const;
/** Documented exclusions inside the mixed category (informational). */
export const EXCLUDED_PRODUCT_SLUGS = [
  "nachos",
  "bbq-wings-4-pcs",
  "chicken-lollipop-6-pcs",
] as const;

export type TrustedLine = {
  categorySlug: string | null | undefined;
  productSlug?: string | null;
  /** Combo lines are excluded (fail closed: combo pricing mixes categories). */
  comboKey?: string | null;
  unitPrice: number;
  quantity: number;
};

/** Category-level check: true for the four fully eligible categories and the mixed one. */
export function isEligibleCategory(slug: string | null | undefined): boolean {
  return (
    typeof slug === "string" &&
    ((ELIGIBLE_CATEGORY_SLUGS as readonly string[]).includes(slug) || slug === MIXED_CATEGORY_SLUG)
  );
}

export function isEligibleLine(
  l: Pick<TrustedLine, "categorySlug" | "productSlug" | "comboKey">,
): boolean {
  if (l.comboKey) return false;
  if (typeof l.categorySlug !== "string") return false;
  if ((ELIGIBLE_CATEGORY_SLUGS as readonly string[]).includes(l.categorySlug)) return true;
  if (l.categorySlug === MIXED_CATEGORY_SLUG) {
    return (
      typeof l.productSlug === "string" &&
      (ELIGIBLE_MIXED_PRODUCT_SLUGS as readonly string[]).includes(l.productSlug)
    );
  }
  return false;
}

/** Sum of eligible food lines only (drinks, addons, sides, combos, unknown excluded). */
export function eligibleSubtotal(lines: readonly TrustedLine[]): number {
  let sum = 0;
  for (const l of lines) {
    if (!isEligibleLine(l)) continue;
    if (
      !Number.isFinite(l.unitPrice) ||
      l.unitPrice < 0 ||
      !Number.isInteger(l.quantity) ||
      l.quantity <= 0
    )
      continue;
    sum += l.unitPrice * l.quantity;
  }
  return Math.round(sum * 100) / 100;
}

export type RewardDiscount =
  | { ok: true; eligibleSubtotal: number; discount: number }
  | {
      ok: false;
      reason: "invalid_percent" | "below_minimum" | "no_eligible_items";
      eligibleSubtotal: number;
      minOrderBdt: number;
    };

/** One combined discount on the eligible subtotal; floor to whole taka. */
export function rewardDiscount(
  lines: readonly TrustedLine[],
  percent: number,
  minOrderBdt: number,
): RewardDiscount {
  const base = eligibleSubtotal(lines);
  const min = Number.isFinite(minOrderBdt) && minOrderBdt > 0 ? minOrderBdt : 0;
  if (!Number.isInteger(percent) || percent <= 0 || percent > 50)
    return { ok: false, reason: "invalid_percent", eligibleSubtotal: base, minOrderBdt: min };
  if (base <= 0)
    return { ok: false, reason: "no_eligible_items", eligibleSubtotal: base, minOrderBdt: min };
  if (base < min)
    return { ok: false, reason: "below_minimum", eligibleSubtotal: base, minOrderBdt: min };
  return {
    ok: true,
    eligibleSubtotal: base,
    discount: Math.min(base, Math.floor((base * percent) / 100)),
  };
}

/** Restoration is allowed only before preparation starts (persisted status). */
export const RESTORABLE_STATUSES = ["placed", "confirmed"] as const;
export function canRestoreReward(persistedStatus: string): boolean {
  return (RESTORABLE_STATUSES as readonly string[]).includes(persistedStatus);
}
