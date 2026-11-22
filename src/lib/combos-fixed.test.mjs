import { describe, expect, test } from "bun:test";
import {
  createPredefinedComboLines, fixedRecipeGroups, isFixedRecipe, offerMaths, recipeFromGroups, regularTotal,
} from "./combos.ts";

const burger = { id: "b", slug: "burger", name: "Classic Burger", basePrice: 181, isAvailable: true, images: [] };
const fries = { id: "f", slug: "fries", name: "Fries", basePrice: 60, isAvailable: true, images: [] };
const combo = (items, price) => ({
  id: "c1", slug: "c1", name: "Deal", description: null, imageUrl: null, pricingMode: "fixed",
  fixedPrice: price, isActive: true, sortOrder: 0,
  groups: fixedRecipeGroups(items).map((g, i) => ({ ...g, id: `g${i}` })),
});

describe("fixed combo recipe", () => {
  test("A. 1 burger + 2 fries saved as exact quantities", () => {
    const g = fixedRecipeGroups([{ productId: "b", quantity: 1 }, { productId: "f", quantity: 2 }]);
    expect(recipeFromGroups(g)).toEqual([{ productId: "b", quantity: 1 }, { productId: "f", quantity: 2 }]);
    expect(g[1].minSelect).toBe(2);
    expect(g[1].maxSelect).toBe(2);
  });
  test("B. editing fries 2 -> 3 gives exactly 3", () => {
    const g = fixedRecipeGroups([{ productId: "b", quantity: 1 }, { productId: "f", quantity: 3 }]);
    expect(recipeFromGroups(g)[1].quantity).toBe(3);
  });
  test("customizable combos are not treated as fixed", () => {
    expect(isFixedRecipe({ pricingMode: "calculated", groups: fixedRecipeGroups([{ productId: "b", quantity: 1 }]) })).toBe(false);
    expect(isFixedRecipe({ pricingMode: "fixed", groups: [{ isRequired: true, minSelect: 1, maxSelect: 2, extraCharge: 0, productIds: ["b"], categoryIds: [] }] })).toBe(false);
  });
});

describe("C. pricing", () => {
  test("৳301 regular, ৳260 offer -> save ৳41, 14% OFF", () => {
    const m = offerMaths(301, 260);
    expect(m.savings).toBe(41);
    expect(m.discountPercent).toBe(14);
  });
  test("৳220 regular, ৳199 offer -> save ৳21, 10% OFF", () => {
    expect(offerMaths(220, 199)).toMatchObject({ savings: 21, discountPercent: 10, valid: true });
  });
  test("offer above regular or zero is invalid, never negative savings", () => {
    expect(offerMaths(100, 120)).toMatchObject({ valid: false, savings: 0 });
    expect(offerMaths(100, 0).valid).toBe(false);
  });
  test("regular total = sum of price x quantity", () => {
    expect(regularTotal([{ unitPrice: 181, quantity: 1 }, { unitPrice: 60, quantity: 2 }])).toBe(301);
  });
});

describe("H. createPredefinedComboLines", () => {
  const c = combo([{ productId: "b", quantity: 1 }, { productId: "f", quantity: 2 }], 260);
  const lines = createPredefinedComboLines(c, [burger, fries], "k");
  test("exact lines, ids preserved, unique line ids, one combo key", () => {
    expect(lines.map((l) => l.productId)).toEqual(["b", "f", "f"]);
    expect(new Set(lines.map((l) => l.lineId)).size).toBe(3);
    expect(new Set(lines.map((l) => l.comboKey))).toEqual(new Set(["c1-k"]));
    expect(lines.every((l) => l.comboId === "c1" && l.quantity === 1)).toBe(true);
  });
  test("lines add up to the offer price", () => {
    expect(lines.reduce((s, l) => s + l.unitPrice, 0)).toBe(260);
  });
  test("sold-out item blocks the bundle", () => {
    expect(() => createPredefinedComboLines(c, [burger, { ...fries, isAvailable: false }])).toThrow();
  });
});
