import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { HoursSettings } from "@/lib/opening-hours";

/** Public: opening hours + scheduling rules (no private data). */
export const getPublicHours = createServerFn({ method: "GET" }).handler(
  async (): Promise<HoursSettings | null> => {
    try {
      const { loadHoursSettings } = await import("@/lib/opening-hours.server");
      return await loadHoursSettings();
    } catch {
      return null;
    }
  },
);

export const ownerGetScheduling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<HoursSettings> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings", "view");
    const { loadHoursSettings } = await import("@/lib/opening-hours.server");
    return loadHoursSettings();
  });

export const ownerUpdateScheduling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        autoHours: z.boolean(),
        scheduledEnabled: z.boolean(),
        maxAdvanceDays: z.number().int().min(1).max(14),
        paymentRequired: z.boolean(),
        prepMinutes: z.number().int().min(0).max(240),
        slotMinutes: z.number().int().min(10).max(120),
        allowWhileClosed: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");
    const { data: row } = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .select("id")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!row) throw new Error("Restaurant settings not found.");
    const { error } = await looseDb(supabaseAdmin)
      .from("restaurant_settings")
      .update({
        auto_hours_enabled: data.autoHours,
        scheduled_orders_enabled: data.scheduledEnabled,
        scheduled_max_advance_days: data.maxAdvanceDays,
        scheduled_payment_required: data.paymentRequired,
        scheduled_prep_minutes: data.prepMinutes,
        scheduled_slot_minutes: data.slotMinutes,
        scheduled_allow_while_closed: data.allowWhileClosed,
      })
      .eq("id", row.id);
    if (error) {
      console.error("Scheduling settings save failed", error);
      throw new Error("We couldn't save these settings. Please try again.");
    }
    return { ok: true };
  });
