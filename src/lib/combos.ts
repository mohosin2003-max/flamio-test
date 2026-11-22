/**
 * Shared, client-safe combo vocabulary and pricing maths.
 *
 * The same helpers run in the browser (live total while building) and on the
 * server (authoritative re-pricing before an order is accepted), so the two can
 * never drift apart. Prices themselves always come from the current menu.
 */

export type ComboPricingMode = "calculated" | "fixed";

export interface ComboGroupDto {
  id: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  extraCharge: number;
  /** Eligible, currently available products resolved on the server. */
  productIds: string[];
  sortOrder: number;
}

export interface ComboDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** Optional combo picture, shown on the customer combo card. */
  imageUrl: string | null;
  pricingMode: ComboPricingMode;
  fixedPrice: number | null;
  isActive: boolean;
  /** Promotional placement only; `isActive` stays the master switch. */
  showInOffers?: boolean;
  showInPopular?: boolean;
  sortOrder: number;
  groups: ComboGroupDto[];
}

/** One chosen item inside a combo build. */
export interface ComboSelection {
  groupId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  imageUrl: string | null;
}

export interface ComboPricing {
  itemsTotal: number;
  extras: number;
  total: number;
  /** Only ever positive when a fixed price is genuinely lower. */
  savings: number;
}

export function comboPricing(combo: ComboDto, selections: ComboSelection[]): ComboPricing {
  const itemsTotal = selections.reduce((sum, s) => sum + s.unitPrice, 0);
  const usedGroups = new Set(selections.map((s) => s.groupId));
  const extras = combo.groups
    .filter((g) => usedGroups.has(g.id))
    .reduce((sum, g) => sum + g.extraCharge, 0);

  if (combo.pricingMode === "fixed" && combo.fixedPrice !== null) {
    const total = Math.max(combo.fixedPrice + extras, 0);
    return { itemsTotal, extras, total, savings: Math.max(itemsTotal + extras - total, 0) };
  }

  const total = itemsTotal + extras;
  return { itemsTotal, extras, total, savings: 0 };
}

/** Human-readable problems that block adding a combo to the cart. */
export function comboSelectionErrors(combo: ComboDto, selections: ComboSelection[]): string[] {
  const errors: string[] = [];
  for (const group of combo.groups) {
    const chosen = selections.filter((s) => s.groupId === group.id);
    const eligible = new Set(group.productIds);
    if (chosen.some((s) => !eligible.has(s.productId))) {
      errors.push(`${group.name}: that item isn't part of this combo.`);
      continue;
    }
    if (group.isRequired && chosen.length < Math.max(group.minSelect, 1)) {
      errors.push(
        `${group.name}: choose ${Math.max(group.minSelect, 1)} item${
          Math.max(group.minSelect, 1) > 1 ? "s" : ""
        }.`,
      );
    }
    if (!group.isRequired && chosen.length > 0 && chosen.length < group.minSelect) {
      errors.push(`${group.name}: choose ${group.minSelect} items or none at all.`);
    }
    if (chosen.length > group.maxSelect) {
      errors.push(`${group.name}: choose at most ${group.maxSelect}.`);
    }
  }
  if (selections.length === 0) errors.push("Pick at least one item.");
  return errors;
}

/**
 * Spreads the combo total over its lines so the cart, the order items and the
 * order total all add up to exactly the combo price — no negative or synthetic
 * line is ever needed.
 */
export function distributeComboPrices(total: number, selections: ComboSelection[]): number[] {
  if (selections.length === 0) return [];
  const base = selections.reduce((sum, s) => sum + s.unitPrice, 0);
  if (base <= 0) {
    const each = Math.floor(total / selections.length);
    const prices = selections.map(() => each);
    prices[prices.length - 1] = total - each * (selections.length - 1);
    return prices;
  }
  const prices = selections.map((s) => Math.round((s.unitPrice / base) * total));
  const drift = total - prices.reduce((a, b) => a + b, 0);
  prices[prices.length - 1] = Math.max((prices[prices.length - 1] ?? 0) + drift, 0);
  return prices;
}

export function groupRequirementLabel(group: ComboGroupDto): string {
  const range =
    group.minSelect === group.maxSelect
      ? `${group.maxSelect}`
      : `${group.minSelect}–${group.maxSelect}`;
  return `${group.isRequired ? "Choose" : "Optional — choose"} ${range}`;
}

/* ------------------------------------------------------------------------ */
/* Fixed promotional combos (Owner-defined predefined bundle).              */
/* Stored in the existing combo tables: one required step per product, with  */
/* that single product and min = max = exact quantity. No new tables.        */
/* ------------------------------------------------------------------------ */

export interface FixedRecipeItem {
  productId: string;
  quantity: number;
}

export const FIXED_COMBO_MAX_QTY = 10;

/** Steps that encode a fixed recipe: one product each, exact quantity. */
export function fixedRecipeGroups(items: FixedRecipeItem[]) {
  return items.map((item, index) => ({
    id: null as string | null,
    name: `Item ${index + 1}`,
    isRequired: true,
    minSelect: item.quantity,
    maxSelect: item.quantity,
    extraCharge: 0,
    categoryIds: [] as string[],
    productIds: [item.productId],
    sortOrder: index,
  }));
}

type GroupLike = {
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  extraCharge: number;
  productIds: string[];
  categoryIds?: string[];
};

/** True when a combo is a predefined bundle (no customer choice at all). */
export function isFixedRecipe(combo: { pricingMode: ComboPricingMode; groups: GroupLike[] }): boolean {
  return (
    combo.pricingMode === "fixed" &&
    combo.groups.length > 0 &&
    combo.groups.every(
      (g) =>
        g.isRequired &&
        g.productIds.length === 1 &&
        (g.categoryIds?.length ?? 0) === 0 &&
        g.minSelect === g.maxSelect &&
        g.minSelect >= 1 &&
        g.extraCharge === 0,
    )
  );
}

export function recipeFromGroups(groups: GroupLike[]): FixedRecipeItem[] {
  return groups.map((g) => ({ productId: g.productIds[0] as string, quantity: g.maxSelect }));
}

export function regularTotal(lines: Array<{ unitPrice: number; quantity: number }>): number {
  return lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
}

export interface OfferMaths {
  regularTotal: number;
  offerPrice: number;
  savings: number;
  /** Nearest whole percent (৳301 → ৳260 shows 14% OFF). */
  discountPercent: number;
  valid: boolean;
  error: string | null;
}

export function offerMaths(regular: number, offerPrice: number | null): OfferMaths {
  const price = Number(offerPrice);
  if (!Number.isFinite(price) || price <= 0) {
    return { regularTotal: regular, offerPrice: 0, savings: 0, discountPercent: 0, valid: false, error: "Set an offer price above 0." };
  }
  if (regular > 0 && price > regular) {
    return { regularTotal: regular, offerPrice: price, savings: 0, discountPercent: 0, valid: false, error: "Offer price can't be higher than the regular total." };
  }
  const savings = Math.max(regular - price, 0);
  const discountPercent = regular > 0 ? Math.round((savings / regular) * 100) : 0;
  return { regularTotal: regular, offerPrice: price, savings, discountPercent, valid: true, error: null };
}

type MenuProductLike = {
  id: string;
  slug: string;
  name: string;
  basePrice: number;
  isAvailable: boolean;
  images?: Array<{ url: string }>;
};

/**
 * Builds the exact cart lines for a fixed combo, ready for `addComboLines()`.
 * Prices here are display only; the server re-prices every line at checkout.
 */
export function createPredefinedComboLines(
  combo: ComboDto,
  products: MenuProductLike[],
  keySeed: string = Date.now().toString(36),
) {
  if (!isFixedRecipe(combo)) throw new Error("This combo is not a fixed bundle.");
  const comboKey = `${combo.id}-${keySeed}`;
  const selections: ComboSelection[] = [];
  for (const group of combo.groups) {
    const product = products.find((p) => p.id === group.productIds[0]);
    if (!product || !product.isAvailable) throw new Error(`${combo.name}: an item is sold out right now.`);
    for (let n = 0; n < group.maxSelect; n += 1) {
      selections.push({
        groupId: group.id,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        variantId: null,
        variantName: null,
        unitPrice: product.basePrice,
        imageUrl: product.images?.[0]?.url ?? null,
      });
    }
  }
  const pricing = comboPricing(combo, selections);
  const prices = distributeComboPrices(pricing.total, selections);
  return selections.map((s, index) => ({
    lineId: `${comboKey}::${s.groupId}::${s.productId}::base::${index}`,
    productId: s.productId,
    productName: s.productName,
    productSlug: s.productSlug,
    variantId: null,
    variantName: null,
    unitPrice: prices[index] ?? s.unitPrice,
    quantity: 1,
    imageUrl: s.imageUrl,
    comboId: combo.id,
    comboName: combo.name,
    comboKey,
    comboGroupId: s.groupId,
  }));
}
