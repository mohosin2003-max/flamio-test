import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_REWARD_CONFIG, REWARD_CONFIG_CEILING_PERCENT, validateRewardConfig } from "./burger-boost-reward-config.ts";

test("Phase 2A defaults are 10/30/7/0/off/off", () => {
  assert.deepEqual(DEFAULT_REWARD_CONFIG, {
    defaultDiscountPercent: 10,
    ownerMaxDiscountPercent: 30,
    couponValidityDays: 7,
    minimumOrderAmount: 0,
    couponStackingEnabled: false,
    rewardSystemEnabled: false,
  });
});

test("30% is the hard configuration ceiling", () => {
  assert.equal(REWARD_CONFIG_CEILING_PERCENT, 30);
  assert.equal(validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, ownerMaxDiscountPercent: 31 }).ok, false);
});

test("default discount cannot exceed maximum", () => {
  assert.equal(validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, defaultDiscountPercent: 31 }).ok, false);
});

test("negative values are rejected", () => {
  assert.equal(validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, defaultDiscountPercent: -1 }).ok, false);
  assert.equal(validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, couponValidityDays: 0 }).ok, false);
  assert.equal(validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, minimumOrderAmount: -1 }).ok, false);
});

test("valid owner configuration is accepted", () => {
  const result = validateRewardConfig({ ...DEFAULT_REWARD_CONFIG, defaultDiscountPercent: 20, ownerMaxDiscountPercent: 25 });
  assert.equal(result.ok, true);
});
