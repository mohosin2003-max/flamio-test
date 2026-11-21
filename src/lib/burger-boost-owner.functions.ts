/**
 * FLAMIO Burger Boost — owner overview (read-only).
 * Server-side permission check reuses assertPermission ("challenges", view).
 * No settings are persisted and no session/analytics/audit data is read:
 * the Burger Boost database objects do not exist yet, so those are reported
 * as unavailable rather than zero.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DRAFT_SETTINGS } from "@/lib/burger-boost-reward-flow";
import { REWARD_BOUNDS } from "@/lib/burger-boost-reward";
import { BURGER_INGREDIENTS, MATH_OPERATIONS, MAX_GATE_COUNT, MIN_GATE_COUNT } from "@/lib/burger-boost-rules";
import { assertOwner } from "@/lib/owner.server";
import { validateRewardConfig, type RewardConfig } from "@/lib/burger-boost-reward-config";

export function buildOwnerOverview() {
  return {
    gameEnabled: false as const,
    checkoutEnabled: false as const,
    discountPercent: 0 as const,
    gateCount: { current: 30, min: MIN_GATE_COUNT, max: MAX_GATE_COUNT, persisted: false as const },
    distribution: { math: 50, ingredient: 30, negative: 20 },
    mathOperations: [...MATH_OPERATIONS],
    ingredients: [...BURGER_INGREDIENTS],
    analytics: { available: false as const, reason: "Burger Boost database not installed yet." },
    rewardDraft: { values: { ...DRAFT_SETTINGS }, bounds: REWARD_BOUNDS, persisted: false as const },
    usage: { available: false as const, reason: "Daily winner counts need the approved database update." },
    rewardHistory: { available: false as const, reason: "No coupons can be issued while the release lock is on." },
    audit: { available: false as const, reason: "Burger Boost database not installed yet." },
  };
}

export const getBurgerBoostOwnerOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "challenges", "view");
    return buildOwnerOverview();
  });

export const getOwnerRewardConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data, error } = await db.schema("burger_boost").rpc("get_reward_config");
    if (error) throw new Error("Reward settings are not installed in TEST yet.");
    const raw = Array.isArray(data) ? data[0] : data;
    const parsed = validateRewardConfig(raw);
    if (!parsed.ok) throw new Error(parsed.errors.join(" "));
    return parsed.config;
  });

export const updateOwnerRewardConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    await assertOwner(context.userId);
    const parsed = validateRewardConfig(data);
    if (!parsed.ok) throw new Error(parsed.errors.join(" "));
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: updated, error } = await db.schema("burger_boost").rpc("update_reward_config", {
      p_default_discount_percent: parsed.config.defaultDiscountPercent,
      p_max_discount_percent: parsed.config.ownerMaxDiscountPercent,
      p_coupon_validity_days: parsed.config.couponValidityDays,
      p_min_order_bdt: parsed.config.minimumOrderAmount,
      p_coupon_stacking_enabled: parsed.config.couponStackingEnabled,
      p_reward_system_enabled: parsed.config.rewardSystemEnabled,
    });
    if (error) throw new Error("Reward settings are not installed in TEST yet.");
    const raw = Array.isArray(updated) ? updated[0] : updated;
    const result = validateRewardConfig(raw);
    if (!result.ok) throw new Error(result.errors.join(" "));
    return result.config;
  });
