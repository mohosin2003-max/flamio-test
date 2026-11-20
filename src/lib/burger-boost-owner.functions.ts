/**
 * FLAMIO Burger Boost — owner overview (read-only).
 * Server-side permission check reuses assertPermission ("challenges", view).
 * No settings are persisted and no session/analytics/audit data is read:
 * the Burger Boost database objects do not exist yet, so those are reported
 * as unavailable rather than zero.
 */
import { createServerFn } from "@tanstack/react-start";
import {
  assertRewardSettingsOwner,
  gameEnabledArgs,
  ownerSettingsArgs,
  setGameEnabledAsOwner,
  parseOwnerRewardSettings,
  unavailableOwnerSettings,
  type RewardSettingsTransport,
} from "@/lib/burger-boost-settings";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DRAFT_SETTINGS } from "@/lib/burger-boost-reward-flow";
import { REWARD_BOUNDS } from "@/lib/burger-boost-reward";
import {
  BURGER_INGREDIENTS,
  MATH_OPERATIONS,
  MAX_GATE_COUNT,
  MIN_GATE_COUNT,
} from "@/lib/burger-boost-rules";

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
    /** Draft defaults only — nothing is saved; the settings table has no such columns yet. */
    rewardDraft: {
      values: { ...DRAFT_SETTINGS },
      bounds: REWARD_BOUNDS,
      persisted: false as const,
    },
    usage: {
      available: false as const,
      reason: "Daily winner counts need the approved database update.",
    },
    rewardHistory: {
      available: false as const,
      reason: "No coupons can be issued while the release lock is on.",
    },
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

export const getOwnerRewardSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleError) throw new Error("Unable to verify Owner access.");
    assertRewardSettingsOwner(roles ?? []);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const transport = supabaseAdmin as unknown as RewardSettingsTransport;
      const { data, error } = await transport.schema("burger_boost").rpc("get_owner_settings");
      return error ? unavailableOwnerSettings : parseOwnerRewardSettings(data);
    } catch {
      return unavailableOwnerSettings;
    }
  });

export const updateOwnerRewardSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ownerSettingsArgs(input))
  .handler(async ({ context, data: args }) => {
    const { data: roles, error: roleError } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roleError) throw new Error("Unable to verify Owner access.");
    assertRewardSettingsOwner(roles ?? []);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const transport = supabaseAdmin as unknown as RewardSettingsTransport;
    const { data, error } = await transport.schema("burger_boost").rpc("update_settings", args);
    if (error)
      throw new Error(
        "Reward settings could not be saved. The approved database update may still be pending.",
      );
    const result = parseOwnerRewardSettings(data);
    if (!result.available) throw new Error("Reward settings returned an invalid response.");
    return result;
  });

export const setBurgerBoostGameEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => gameEnabledArgs(input))
  .handler(async ({ context, data: args }) =>
    setGameEnabledAsOwner({
      args,
      loadRoles: () =>
        context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      loadTransport: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        return supabaseAdmin as unknown as RewardSettingsTransport;
      },
    }),
  );
