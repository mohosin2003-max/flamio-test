import { describe, expect, test } from "bun:test";
import {
  dhakaDate, fullDiscount, partialDiscount, validateRewardSettings, canStartReward, recordRewardStart,
  allocateReward, checkCoupon, COUPON_VALIDITY_MS,
} from "./burger-boost-reward.ts";

const S = { ownerMax: 40, partialMax: 20, dailyFullLimit: 1, dailyPartialLimit: 1, minOrderBdt: 300, gateCount: 30 };
// 2026-11-11 18:00 UTC = 2026-11-12 00:00 Dhaka
const MIDNIGHT = Date.UTC(2026, 10, 11, 18, 0, 0);

describe("discount formulas", () => {
  test("full at 0/1/50/99/100", () => {
    expect([0, 1, 50, 99, 100].map((m) => fullDiscount(40, m))).toEqual([0, 0, 20, 39, 40]);
  });
  test("partial at 0/1/50/99/100", () => {
    expect([0, 1, 50, 99, 100].map((m) => partialDiscount(20, m))).toEqual([0, 0, 10, 19, 20]);
  });
  test("boundaries: max 0 and 50, meter above 100 capped", () => {
    expect(fullDiscount(0, 100)).toBe(0);
    expect(fullDiscount(50, 100)).toBe(50);
    expect(fullDiscount(40, 300)).toBe(40);
    expect(fullDiscount(1, 100)).toBe(1);
  });
  test("zero and negative meter give no reward", () => {
    expect(fullDiscount(40, 0)).toBe(0);
    expect(fullDiscount(40, -25)).toBe(0);
    expect(partialDiscount(20, -1)).toBe(0);
  });
  test("never exceeds OwnerMax", () => {
    for (let m = -50; m <= 400; m += 7) expect(fullDiscount(40, m)).toBeLessThanOrEqual(40);
  });
  test("PartialMax > OwnerMax rejected; equal allowed", () => {
    expect(validateRewardSettings({ ...S, partialMax: 41 }).ok).toBe(false);
    expect(validateRewardSettings({ ...S, partialMax: 40 }).ok).toBe(true);
  });
  test("negative quotas rejected", () => {
    expect(validateRewardSettings({ ...S, dailyFullLimit: -1 }).ok).toBe(false);
    expect(validateRewardSettings({ ...S, dailyPartialLimit: -1 }).ok).toBe(false);
  });
});

describe("Dhaka daily date", () => {
  test("midnight rollover", () => {
    expect(dhakaDate(MIDNIGHT - 1)).toBe("2026-11-11");
    expect(dhakaDate(MIDNIGHT)).toBe("2026-11-12");
  });
  test("UTC date differs from Dhaka date", () => {
    const t = Date.UTC(2026, 10, 11, 20, 0, 0);
    expect(new Date(t).toISOString().slice(0, 10)).toBe("2026-11-11");
    expect(dhakaDate(t)).toBe("2026-11-12");
  });
  test("fixed UTC+6 all year (no DST shift)", () => {
    expect(dhakaDate(Date.UTC(2026, 0, 15, 18, 0))).toBe("2026-01-16");
    expect(dhakaDate(Date.UTC(2026, 6, 15, 18, 0))).toBe("2026-07-16");
  });
  test("same user: one attempt before midnight, new attempt after", () => {
    const ledger = new Map();
    expect(canStartReward(ledger, "u1", MIDNIGHT - 60000).allowed).toBe(true);
    expect(recordRewardStart(ledger, "u1", MIDNIGHT - 60000, true)).toBe(true);
    expect(canStartReward(ledger, "u1", MIDNIGHT - 1).allowed).toBe(false);
    expect(recordRewardStart(ledger, "u1", MIDNIGHT - 1, true)).toBe(false);
    expect(canStartReward(ledger, "u1", MIDNIGHT).allowed).toBe(true);
    expect(canStartReward(ledger, "u2", MIDNIGHT - 1).allowed).toBe(true);
  });
  test("failed session creation consumes nothing", () => {
    const ledger = new Map();
    expect(recordRewardStart(ledger, "u1", MIDNIGHT, false)).toBe(false);
    expect(canStartReward(ledger, "u1", MIDNIGHT).allowed).toBe(true);
  });
});

describe("reference allocator (in-memory; NOT proof of concurrency safety)", () => {
  const usage = () => ({ date: dhakaDate(MIDNIGHT), fullUsed: 0, partialUsed: 0 });
  test("full first, then partial, then none", () => {
    const u = usage();
    expect(allocateReward(u, S, "reward", 100, MIDNIGHT)).toMatchObject({ tier: "full", discountPercent: 40 });
    expect(allocateReward(u, S, "reward", 100, MIDNIGHT)).toMatchObject({ tier: "partial", discountPercent: 20 });
    expect(allocateReward(u, S, "reward", 100, MIDNIGHT)).toEqual({ tier: "none", discountPercent: 0, reason: "quota_exhausted" });
  });
  test("zero quotas: no reward", () => {
    expect(allocateReward(usage(), { ...S, dailyFullLimit: 0, dailyPartialLimit: 0 }, "reward", 100, MIDNIGHT).tier).toBe("none");
  });
  test("loss allocates nothing and uses no slot", () => {
    const u = usage();
    expect(allocateReward(u, S, "reward", 0, MIDNIGHT).reason).toBe("loss");
    expect(allocateReward(u, S, "reward", -10, MIDNIGHT).reason).toBe("loss");
    expect(u).toEqual(usage());
  });
  test("practice never allocates", () => {
    const u = usage();
    expect(allocateReward(u, S, "practice", 100, MIDNIGHT).reason).toBe("practice");
    expect(u.fullUsed).toBe(0);
  });
  test("computed 0% creates no coupon and no slot", () => {
    const u = usage();
    expect(allocateReward(u, S, "reward", 1, MIDNIGHT).reason).toBe("zero_discount");
    expect(u.fullUsed).toBe(0);
  });
  test("coupon expires 7 days after allocation", () => {
    const a = allocateReward(usage(), S, "reward", 50, MIDNIGHT);
    expect(a.expiresAt - MIDNIGHT).toBe(7 * 24 * 3600 * 1000);
  });
});

describe("coupon rules", () => {
  const c = { userId: "u1", discountPercent: 20, issuedAt: MIDNIGHT, expiresAt: MIDNIGHT + COUPON_VALIDITY_MS, usedAt: null };
  test("valid within 7 days, expired at 7 days", () => {
    expect(checkCoupon(c, "u1", 500, 300, 0, MIDNIGHT + COUPON_VALIDITY_MS - 1).ok).toBe(true);
    expect(checkCoupon(c, "u1", 500, 300, 0, MIDNIGHT + COUPON_VALIDITY_MS)).toEqual({ ok: false, reason: "expired" });
  });
  test("no stacking", () => {
    expect(checkCoupon(c, "u1", 500, 300, 1, MIDNIGHT)).toEqual({ ok: false, reason: "stacking" });
  });
  test("zero or negative discount coupon invalid", () => {
    expect(checkCoupon({ ...c, discountPercent: 0 }, "u1", 500, 300, 0, MIDNIGHT).ok).toBe(false);
    expect(checkCoupon({ ...c, discountPercent: -5 }, "u1", 500, 300, 0, MIDNIGHT).ok).toBe(false);
  });
});
