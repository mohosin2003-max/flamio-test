/**
 * FLAMIO Burger Boost — owner overview (read-only).
 * Server-side permission check reuses assertPermission ("challenges", view).
 * No settings are persisted and no session/analytics/audit data is read:
 * the Burger Boost database objects do not exist yet, so those are reported
 * as unavailable rather than zero.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BURGER_INGREDIENTS, MATH_OPERATIONS, MAX_GATE_COUNT, MIN_GATE_COUNT } from "@/lib/burger-boost-rules";

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
