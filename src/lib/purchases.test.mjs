import { describe, expect, test } from "bun:test";

import { calculatePurchaseSubtotal } from "./purchases.functions.ts";

describe("purchase subtotal", () => {
  test("multiplies quantity by unit price", () => {
    expect(calculatePurchaseSubtotal(3, 125.5)).toBe(376.5);
  });
});