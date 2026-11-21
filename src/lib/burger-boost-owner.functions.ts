import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/owner.server";
import { validateRewardConfig, type RewardConfig } from "@/lib/burger-boost-reward-config";

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
