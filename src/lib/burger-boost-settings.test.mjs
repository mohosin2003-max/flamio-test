import { describe, expect, test } from "bun:test";
import { assertRewardSettingsOwner, ownerSettingsArgs, parseOwnerRewardSettings, publicRewardSettings } from "./burger-boost-settings.ts";
import { storeDiscountPreview } from "./burger-boost-pause.ts";

const settings = { ownerMax: 20, partialMax: 10, dailyFullLimit: 5, dailyPartialLimit: 10, minOrderBdt: 500, gateCount: 30 };
const row = { owner_max_discount: 20, partial_max_discount: 10, daily_full_limit: 5, daily_partial_limit: 10, min_order_bdt: 500, gate_count: 30, claim_expiry_minutes: 30, dhaka_date: "2026-11-19", full_used: 1, full_reserved: 2, partial_used: 3, partial_reserved: 4 };

describe("Step 4B settings contracts (pure, no database)", () => {
  test("missing or invalid public settings fail closed at ownerMax zero", () => {
    for (const value of [null, undefined, "20", -1, 51, NaN, { owner_max_discount: 20 }]) {
      expect(publicRewardSettings(value)).toEqual({ ownerMax: 0 });
    }
  });
  test("server ownerMax feeds the unchanged practice formula", () => {
    expect(storeDiscountPreview(publicRewardSettings(20).ownerMax, 75)).toBe(15);
    expect(storeDiscountPreview(publicRewardSettings(0).ownerMax, 100)).toBe(0);
  });
  test("Owner settings use exact intended RPC argument names", () => {
    expect(ownerSettingsArgs(settings)).toEqual({ p_owner_max: 20, p_partial_max: 10, p_full_limit: 5, p_partial_limit: 10, p_min_order: 500, p_gate_count: 30 });
  });
  test("partial discount cannot exceed Owner maximum", () => {
    expect(() => ownerSettingsArgs({ ...settings, partialMax: 21 })).toThrow();
  });
  test("only the actual Owner role may manage reward settings", () => {
    expect(() => assertRewardSettingsOwner([{ role: "owner" }])).not.toThrow();
    for (const roles of [[], [{ role: "staff" }], [{ role: "admin" }]]) {
      expect(() => assertRewardSettingsOwner(roles)).toThrow("Forbidden");
    }
  });
  test("reservation expiry contract is 30 minutes, never 15", () => {
    expect(parseOwnerRewardSettings(row).claimExpiryMinutes).toBe(30);
    expect(parseOwnerRewardSettings({ ...row, claim_expiry_minutes: 15 }).available).toBe(false);
  });
  test("Owner row maps persisted settings and reservations, not invented counts", () => {
    expect(parseOwnerRewardSettings(row)).toEqual({ available: true, settings, claimExpiryMinutes: 30, usage: { date: "2026-11-19", fullUsed: 1, fullReserved: 2, partialUsed: 3, partialReserved: 4 } });
    expect(parseOwnerRewardSettings(null).usage).toBeNull();
  });
});