/**
 * FLAMIO Burger Boost — Step 53 server completion decision (PURE, inactive).
 *
 * Pure reward policy mirror for the live TEST Phase 2 flow.
 * The authoritative reward amount and coupon/checkout state are enforced by
 * the TEST database RPCs; this module is not proof of atomicity.
 */
import { allocateReward, type Allocation, type DailyUsage, type RewardSettings, type SessionMode } from "./burger-boost-reward";

/** Mirrors the approved TEST Phase 2 release state. */
export const RELEASE_LOCKS = { couponIssuance: true, checkout: true } as const;

export type CompletionDecision =
  | { kind: "practice"; awardedDiscountPercent: 0 }
  | { kind: "loss"; awardedDiscountPercent: 0 }
  | { kind: "no_reward"; awardedDiscountPercent: 0; reason: "quota_exhausted" | "zero_discount" }
  | { kind: "release_locked"; awardedDiscountPercent: 0; eligibleTier: "full" | "partial"; previewDiscountPercent: number }
  | { kind: "issue"; awardedDiscountPercent: number; tier: "full" | "partial"; expiresAt: number };

export function decideCompletion(input: {
  mode: SessionMode | undefined; finalMeter: number; settings: RewardSettings; usage: DailyUsage;
  sessionStartedAt: number; locks?: { couponIssuance: boolean };
}): CompletionDecision {
  const locks = input.locks ?? RELEASE_LOCKS;
  if (input.mode !== "reward") return { kind: "practice", awardedDiscountPercent: 0 };
  if (!Number.isFinite(input.finalMeter) || input.finalMeter <= 0) return { kind: "loss", awardedDiscountPercent: 0 };
  // Allocation day = the session's START Dhaka date, never completion time.
  if (!locks.couponIssuance) {
    const copy: DailyUsage = { ...input.usage };
    const a: Allocation = allocateReward(copy, input.settings, "reward", input.finalMeter, input.sessionStartedAt);
    if (a.tier === "none") return { kind: "no_reward", awardedDiscountPercent: 0, reason: a.reason === "zero_discount" ? "zero_discount" : "quota_exhausted" };
    return { kind: "release_locked", awardedDiscountPercent: 0, eligibleTier: a.tier, previewDiscountPercent: a.discountPercent };
  }
  const a = allocateReward(input.usage, input.settings, "reward", input.finalMeter, input.sessionStartedAt);
  if (a.tier === "none") return { kind: "no_reward", awardedDiscountPercent: 0, reason: a.reason === "zero_discount" ? "zero_discount" : "quota_exhausted" };
  return { kind: "issue", awardedDiscountPercent: a.discountPercent, tier: a.tier, expiresAt: a.expiresAt };
}

/** Owner draft defaults: no invented business values. Not persisted. */
export const DRAFT_SETTINGS: RewardSettings = {
  ownerMax: 0, partialMax: 0, dailyFullLimit: 0, dailyPartialLimit: 0, minOrderBdt: 0, gateCount: 30,
};
