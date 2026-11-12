import { describe, expect, test } from "bun:test";
import { checkCoupon, validateRewardSettings, COUPON_VALIDITY_MS } from "./burger-boost-reward.ts";

const NOW = Date.UTC(2026, 10, 12, 4, 0, 0);
const mk = () => ({ userId: "u1", discountPercent: 20, issuedAt: NOW, expiresAt: NOW + COUPON_VALIDITY_MS, usedAt: null });
const S = { ownerMax: 40, partialMax: 20, dailyFullLimit: 1, dailyPartialLimit: 1, minOrderBdt: 300, gateCount: 30 };

describe("minimum order value (helper layer only)", () => {
  test("MOV 0 permits a valid coupon", () => {
    expect(checkCoupon(mk(), "u1", 0, 0, 0, NOW)).toEqual({ ok: true });
    expect(checkCoupon(mk(), "u1", 150, 0, 0, NOW)).toEqual({ ok: true });
  });
  test("below MOV rejected", () => {
    expect(checkCoupon(mk(), "u1", 299, 300, 0, NOW)).toEqual({ ok: false, reason: "below_minimum" });
    expect(checkCoupon(mk(), "u1", 299.99, 300, 0, NOW)).toEqual({ ok: false, reason: "below_minimum" });
    expect(checkCoupon(mk(), "u1", NaN, 300, 0, NOW)).toEqual({ ok: false, reason: "below_minimum" });
  });
  test("exactly MOV accepted", () => expect(checkCoupon(mk(), "u1", 300, 300, 0, NOW)).toEqual({ ok: true }));
  test("above MOV accepted", () => expect(checkCoupon(mk(), "u1", 301, 300, 0, NOW)).toEqual({ ok: true }));
  test("negative / out-of-range / fractional MOV rejected in settings", () => {
    expect(validateRewardSettings({ ...S, minOrderBdt: -1 }).ok).toBe(false);
    expect(validateRewardSettings({ ...S, minOrderBdt: 100_001 }).ok).toBe(false);
    expect(validateRewardSettings({ ...S, minOrderBdt: 1.5 }).ok).toBe(false);
    expect(validateRewardSettings({ ...S, minOrderBdt: 0 }).ok).toBe(true);
    expect(validateRewardSettings({ ...S, minOrderBdt: 100_000 }).ok).toBe(true);
  });
  test("MOV check does not alter discount; rejection does not mutate coupon", () => {
    const c = mk(); const before = structuredClone(c);
    checkCoupon(c, "u1", 100, 300, 0, NOW);
    checkCoupon(c, "u1", 500, 300, 0, NOW);
    expect(c).toEqual(before);
    expect(c.discountPercent).toBe(20);
  });
});
