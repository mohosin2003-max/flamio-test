import { describe, expect, test } from "bun:test";
import { rewardDiscount, eligibleSubtotal, isEligibleCategory, canRestoreReward } from "./burger-boost-eligibility.ts";

const L = (categorySlug, unitPrice, quantity = 1) => ({ categorySlug, unitPrice, quantity });

describe("Burger Boost reward eligibility", () => {
  test("five food categories eligible", () => {
    for (const s of ["burger", "meat-box", "pizza", "pasta", "shawarma-and-sides"]) expect(isEligibleCategory(s)).toBe(true);
  });
  test("drinks, addons and unknown excluded", () => {
    for (const s of ["drinks", "addons", "", null, undefined, "Burger"]) expect(isEligibleCategory(s)).toBe(false);
  });
  test("৳300 eligible food at 10% saves ৳30", () => {
    expect(rewardDiscount([L("burger", 100, 3)], 10, 0)).toEqual({ ok: true, eligibleSubtotal: 300, discount: 30 });
  });
  test("mixed cart discounts only food", () => {
    const r = rewardDiscount([L("pizza", 200), L("drinks", 80), L("addons", 40)], 20, 0);
    expect(r).toEqual({ ok: true, eligibleSubtotal: 200, discount: 40 });
  });
  test("minimum order applies to eligible subtotal", () => {
    expect(rewardDiscount([L("burger", 100), L("drinks", 500)], 10, 300).ok).toBe(false);
    expect(rewardDiscount([L("burger", 100, 3)], 10, 300).ok).toBe(true);
  });
  test("percent above 50 or zero rejected", () => {
    expect(rewardDiscount([L("burger", 100)], 51, 0).ok).toBe(false);
    expect(rewardDiscount([L("burger", 100)], 0, 0).ok).toBe(false);
  });
  test("bad quantities ignored", () => {
    expect(eligibleSubtotal([L("burger", 100, 0), L("burger", -5, 1), L("burger", 100, 1.5)])).toBe(0);
  });
  test("restore only before preparing", () => {
    expect(canRestoreReward("placed")).toBe(true); expect(canRestoreReward("confirmed")).toBe(true);
    for (const s of ["preparing", "ready", "out_for_delivery", "completed", "scheduled", "cancelled"]) expect(canRestoreReward(s)).toBe(false);
  });
});
