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
