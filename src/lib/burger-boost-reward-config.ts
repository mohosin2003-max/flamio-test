/**
 * FLAMIO Burger Boost — Phase 2A reward configuration.
 * Configuration-only foundation. Phase 1 reward locks remain active elsewhere.
 */
export const REWARD_CONFIG_CEILING_PERCENT = 30 as const;

export type RewardConfig = {
  defaultDiscountPercent: number;
  ownerMaxDiscountPercent: number;
  couponValidityDays: number;
  minimumOrderAmount: number;
  couponStackingEnabled: boolean;
  rewardSystemEnabled: boolean;
};

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  defaultDiscountPercent: 10,
  ownerMaxDiscountPercent: 30,
  couponValidityDays: 7,
  minimumOrderAmount: 0,
  couponStackingEnabled: false,
  rewardSystemEnabled: false,
};

export type RewardConfigCheck =
  | { ok: true; config: RewardConfig }
  | { ok: false; errors: string[] };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

export function validateRewardConfig(input: unknown): RewardConfigCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Reward settings are missing."] };
  }
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  const keys = [
    "defaultDiscountPercent",
    "ownerMaxDiscountPercent",
    "couponValidityDays",
    "minimumOrderAmount",
    "couponStackingEnabled",
    "rewardSystemEnabled",
  ] as const;

  for (const key of keys) if (!(key in o)) errors.push(`Missing setting: ${key}`);
  for (const key of keys.slice(0, 4)) if (!isInt(o[key])) errors.push(`${key} must be a whole number.`);
  if (typeof o.couponStackingEnabled !== "boolean") errors.push("couponStackingEnabled must be boolean.");
  if (typeof o.rewardSystemEnabled !== "boolean") errors.push("rewardSystemEnabled must be boolean.");

  if (isInt(o.defaultDiscountPercent) && o.defaultDiscountPercent < 0) errors.push("Default discount cannot be negative.");
  if (isInt(o.ownerMaxDiscountPercent) && (o.ownerMaxDiscountPercent < 0 || o.ownerMaxDiscountPercent > REWARD_CONFIG_CEILING_PERCENT)) {
    errors.push(`Maximum discount must be 0–${REWARD_CONFIG_CEILING_PERCENT}%.`);
  }
  if (isInt(o.defaultDiscountPercent) && isInt(o.ownerMaxDiscountPercent) && o.defaultDiscountPercent > o.ownerMaxDiscountPercent) {
    errors.push("Default discount cannot exceed maximum discount.");
  }
  if (isInt(o.couponValidityDays) && (o.couponValidityDays < 1 || o.couponValidityDays > 365)) {
    errors.push("Coupon validity must be 1–365 days.");
  }
  if (isInt(o.minimumOrderAmount) && (o.minimumOrderAmount < 0 || o.minimumOrderAmount > 100_000)) {
    errors.push("Minimum order must be 0–100000 BDT.");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    config: {
      defaultDiscountPercent: o.defaultDiscountPercent as number,
      ownerMaxDiscountPercent: o.ownerMaxDiscountPercent as number,
      couponValidityDays: o.couponValidityDays as number,
      minimumOrderAmount: o.minimumOrderAmount as number,
      couponStackingEnabled: o.couponStackingEnabled as boolean,
      rewardSystemEnabled: o.rewardSystemEnabled as boolean,
    },
  };
}
