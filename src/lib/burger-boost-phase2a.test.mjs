import { describe, expect, test } from "bun:test";
import {
  INITIAL_REWARD_CONFIG, readRewardConfigAsOwner, rewardConfigArgs,
  updateRewardConfigAsOwner, validateRewardConfig,
} from "./burger-boost-reward-config.ts";
import { RELEASE_LOCKS, decideCompletion, DRAFT_SETTINGS } from "./burger-boost-reward-flow.ts";

const dbRow = (c) => ({
  default_discount_percent: c.defaultDiscountPercent, owner_max_discount_percent: c.ownerMaxDiscountPercent,
  coupon_validity_days: c.couponValidityDays, minimum_order_amount: c.minimumOrderAmount,
  coupon_stacking_enabled: c.couponStackingEnabled, reward_system_enabled: c.rewardSystemEnabled,
});
function fake(roles) {
  const calls = []; let loaded = 0; let stored = { ...INITIAL_REWARD_CONFIG };
  const transport = { schema: (s) => ({ rpc: async (name, a) => {
    calls.push({ s, name, a });
    if (name === "update_reward_config") stored = {
      defaultDiscountPercent: a.p_default, ownerMaxDiscountPercent: a.p_max, couponValidityDays: a.p_validity_days,
      minimumOrderAmount: a.p_min_order, couponStackingEnabled: a.p_stacking, rewardSystemEnabled: a.p_enabled };
    return { data: dbRow(stored), error: null };
  } }) };
  return { calls, loaded: () => loaded, deps: {
    loadRoles: async () => ({ data: roles, error: null }),
    loadTransport: async () => { loaded++; return transport; },
  } };
}

describe("Phase 2A owner reward settings", () => {
  test("initial defaults are 10/30/7/0/off/off", () => {
    expect(INITIAL_REWARD_CONFIG).toEqual({ defaultDiscountPercent: 10, ownerMaxDiscountPercent: 30,
      couponValidityDays: 7, minimumOrderAmount: 0, couponStackingEnabled: false, rewardSystemEnabled: false });
  });
  test("authorized Owner can read settings", async () => {
    const f = fake([{ role: "owner" }]);
    const r = await readRewardConfigAsOwner(f.deps);
    expect(r).toEqual({ available: true, config: INITIAL_REWARD_CONFIG });
  });
  test("authorized Owner can update allowed settings", async () => {
    const f = fake([{ role: "owner" }]);
    const next = { ...INITIAL_REWARD_CONFIG, defaultDiscountPercent: 15, ownerMaxDiscountPercent: 25, couponValidityDays: 3, minimumOrderAmount: 500 };
    const r = await updateRewardConfigAsOwner({ ...f.deps, args: rewardConfigArgs(next) });
    expect(r.config).toEqual(next);
    expect(f.calls.at(-1).name).toBe("update_reward_config");
  });
  for (const roles of [[{ role: "staff" }], [{ role: "manager" }], [{ role: "customer" }], []]) {
    test(`non-Owner ${JSON.stringify(roles)} cannot update or read`, async () => {
      const f = fake(roles);
      await expect(updateRewardConfigAsOwner({ ...f.deps, args: rewardConfigArgs(INITIAL_REWARD_CONFIG) })).rejects.toThrow("Forbidden");
      await expect(readRewardConfigAsOwner(f.deps)).rejects.toThrow("Forbidden");
      expect(f.loaded()).toBe(0);
    });
  }
  test("maximum discount above 30% is rejected", () => {
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, ownerMaxDiscountPercent: 31 }).ok).toBe(false);
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, ownerMaxDiscountPercent: 30 }).ok).toBe(true);
  });
  test("default discount above the maximum is rejected", () => {
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, ownerMaxDiscountPercent: 20, defaultDiscountPercent: 21 }).ok).toBe(false);
  });
  test("negative / non-positive values are rejected", () => {
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, defaultDiscountPercent: -1 }).ok).toBe(false);
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, minimumOrderAmount: -1 }).ok).toBe(false);
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, couponValidityDays: 0 }).ok).toBe(false);
    expect(() => rewardConfigArgs({ ...INITIAL_REWARD_CONFIG, ownerMaxDiscountPercent: -5 })).toThrow();
  });
  test("stacking must be an explicit boolean; unknown keys rejected", () => {
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, couponStackingEnabled: "yes" }).ok).toBe(false);
    expect(validateRewardConfig({ ...INITIAL_REWARD_CONFIG, extra: 1 }).ok).toBe(false);
  });
  test("Phase 1 locks unchanged: coupon/checkout locked and 0% awarded", () => {
    expect(RELEASE_LOCKS).toEqual({ couponIssuance: false, checkout: false });
    const d = decideCompletion({ mode: "reward", finalMeter: 100,
      settings: { ...DRAFT_SETTINGS, ownerMax: 30, dailyFullLimit: 5 },
      usage: { date: "2026-11-21", fullUsed: 0, partialUsed: 0 }, sessionStartedAt: Date.parse("2026-11-21T06:00:00Z") });
    expect(d.awardedDiscountPercent).toBe(0);
  });
});
