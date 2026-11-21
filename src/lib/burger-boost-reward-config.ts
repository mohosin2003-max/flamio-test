/**
 * Phase 2A Owner reward configuration (inert). These values are stored for a
 * future approved release; they never change Phase 1 locks: sessions still
 * award 0%, coupon issuance and reward checkout stay locked (RELEASE_LOCKS).
 */
import { assertRewardSettingsOwner } from "./burger-boost-settings";

/** Security ceiling, independent of any Owner-chosen maximum. */
export const REWARD_CONFIG_CEILING_PERCENT = 30;

export type RewardConfig = {
  defaultDiscountPercent: number;
  ownerMaxDiscountPercent: number;
  couponValidityDays: number;
  minimumOrderAmount: number;
  couponStackingEnabled: boolean;
  rewardSystemEnabled: boolean;
};

/** Initial values only — the Owner can change them; not permanent rules. */
export const INITIAL_REWARD_CONFIG: RewardConfig = {
  defaultDiscountPercent: 10,
  ownerMaxDiscountPercent: 30,
  couponValidityDays: 7,
  minimumOrderAmount: 0,
  couponStackingEnabled: false,
  rewardSystemEnabled: false,
};

const KEYS = Object.keys(INITIAL_REWARD_CONFIG) as (keyof RewardConfig)[];
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

export function validateRewardConfig(input: unknown): { ok: true; config: RewardConfig } | { ok: false; errors: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, errors: ["Settings are missing."] };
  const o = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const k of Object.keys(o)) if (!(KEYS as string[]).includes(k)) errors.push(`Unknown setting: ${k}`);
  for (const k of ["defaultDiscountPercent", "ownerMaxDiscountPercent", "couponValidityDays", "minimumOrderAmount"] as const)
    if (!isInt(o[k])) errors.push(`${k} must be a whole number.`);
  for (const k of ["couponStackingEnabled", "rewardSystemEnabled"] as const)
    if (typeof o[k] !== "boolean") errors.push(`${k} must be on or off.`);
  if (errors.length) return { ok: false, errors };
  const c = o as unknown as RewardConfig;
  if (c.ownerMaxDiscountPercent < 0 || c.ownerMaxDiscountPercent > REWARD_CONFIG_CEILING_PERCENT)
    errors.push(`Maximum discount must be 0–${REWARD_CONFIG_CEILING_PERCENT}%.`);
  if (c.defaultDiscountPercent < 0) errors.push("Default discount can't be negative.");
  if (c.defaultDiscountPercent > c.ownerMaxDiscountPercent) errors.push("Default discount can't be higher than the maximum.");
  if (c.couponValidityDays < 1 || c.couponValidityDays > 365) errors.push("Coupon validity must be 1–365 days.");
  if (c.minimumOrderAmount < 0 || c.minimumOrderAmount > 100_000) errors.push("Minimum order must be 0–100000.");
  return errors.length ? { ok: false, errors } : { ok: true, config: { ...c } };
}

export function rewardConfigArgs(input: unknown) {
  const v = validateRewardConfig(input);
  if (!v.ok) throw new Error(v.errors.join(" "));
  const c = v.config;
  return {
    p_default: c.defaultDiscountPercent,
    p_max: c.ownerMaxDiscountPercent,
    p_validity_days: c.couponValidityDays,
    p_min_order: c.minimumOrderAmount,
    p_stacking: c.couponStackingEnabled,
    p_enabled: c.rewardSystemEnabled,
  };
}

export function parseRewardConfig(value: unknown): RewardConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const v = validateRewardConfig({
    defaultDiscountPercent: r["default_discount_percent"],
    ownerMaxDiscountPercent: r["owner_max_discount_percent"],
    couponValidityDays: r["coupon_validity_days"],
    minimumOrderAmount: r["minimum_order_amount"],
    couponStackingEnabled: r["coupon_stacking_enabled"],
    rewardSystemEnabled: r["reward_system_enabled"],
  });
  return v.ok ? v.config : null;
}

export type RewardConfigTransport = {
  schema(name: "burger_boost"): {
    rpc(name: "get_reward_config" | "update_reward_config", args?: ReturnType<typeof rewardConfigArgs>): PromiseLike<{ data: unknown; error: unknown }>;
  };
};
type Deps = {
  loadRoles: () => PromiseLike<{ data: { role: string }[] | null; error: unknown }>;
  loadTransport: () => Promise<RewardConfigTransport>;
};
export type RewardConfigResult = { available: boolean; config: RewardConfig | null };

async function verifyOwner(deps: Deps) {
  const { data, error } = await deps.loadRoles();
  if (error) throw new Error("Unable to verify Owner access.");
  assertRewardSettingsOwner(data ?? []);
}

export async function readRewardConfigAsOwner(deps: Deps): Promise<RewardConfigResult> {
  await verifyOwner(deps);
  try {
    const t = await deps.loadTransport();
    const { data, error } = await t.schema("burger_boost").rpc("get_reward_config");
    const config = error ? null : parseRewardConfig(data);
    return { available: config !== null, config };
  } catch {
    return { available: false, config: null };
  }
}

export async function updateRewardConfigAsOwner(deps: Deps & { args: ReturnType<typeof rewardConfigArgs> }): Promise<RewardConfigResult> {
  await verifyOwner(deps);
  const t = await deps.loadTransport();
  const { data, error } = await t.schema("burger_boost").rpc("update_reward_config", deps.args);
  if (error) throw new Error("Reward settings could not be saved. The approved database update may still be pending.");
  const config = parseRewardConfig(data);
  if (!config) throw new Error("Reward settings returned an invalid response.");
  return { available: true, config };
}
