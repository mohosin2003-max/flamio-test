import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Push subscription management plus the owner's personal (one customer)
 * notification. Everything reuses the existing push_tokens / notifications
 * tables and the existing permission helpers.
 */

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(600),
  p256dh: z.string().min(10).max(300),
  auth: z.string().min(5).max(300),
  platform: z.string().trim().max(20).default("web"),
});

export const registerPushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => subscriptionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");

    const { error } = await looseDb(supabaseAdmin).from("push_tokens").upsert(
      {
        user_id: context.userId,
        token: data.endpoint,
        p256dh: data.p256dh,
        auth: data.auth,
        platform: data.platform || "web",
        is_active: true,
        failure_count: 0,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );

    if (error) {
      console.error("Push subscription save failed", error);
      throw new Error("We couldn't turn on notifications on this device.");
    }
    return { ok: true };
  });

export const disablePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ endpoint: z.string().url().max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");
    const { error } = await looseDb(supabaseAdmin)
      .from("push_tokens")
      .update({ is_active: false })
      .eq("token", data.endpoint)
      .eq("user_id", context.userId);
    if (error) throw new Error("We couldn't turn off notifications on this device.");
    return { ok: true };
  });

/** Customers who have an account — the audience for a personal message. */
export const ownerListNotifiableCustomers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<
      { userId: string; name: string; lastOrderAt: string | null; hasDevice: boolean }[]
    > => {
      const { assertPermission } = await import("@/lib/owner.server");
      await assertPermission(context.userId, "customers", "view");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("user_id, customer_name, created_at")
        .not("user_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(5000);

      const byUser = new Map<string, { name: string; lastOrderAt: string }>();
      for (const row of orders ?? []) {
        const id = row.user_id as string;
        if (!byUser.has(id)) {
          byUser.set(id, { name: row.customer_name, lastOrderAt: row.created_at });
        }
      }

      const ids = [...byUser.keys()];
      if (ids.length === 0) return [];

      const { looseDb } = await import("@/integrations/supabase/loose.server");
      const { data: tokens } = await looseDb(supabaseAdmin)
        .from("push_tokens")
        .select("user_id")
        .in("user_id", ids)
        .eq("is_active", true);
      const withDevice = new Set((tokens ?? []).map((t) => t.user_id as string));

      return ids.map((id) => ({
        userId: id,
        name: byUser.get(id)?.name ?? "Customer",
        lastOrderAt: byUser.get(id)?.lastOrderAt ?? null,
        hasDevice: withDevice.has(id),
      }));
    },
  );

/**
 * Owner → one customer. A personal notification, kept separate from automatic
 * order notifications and from broadcasts.
 */
export const ownerSendCustomerNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        title: z.string().trim().min(3).max(80),
        body: z.string().trim().min(3).max(300),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers");

    const { notifyUsers } = await import("@/lib/push.server");
    const result = await notifyUsers(
      [
        {
          userId: data.userId,
          kind: "personal",
          status: "personal",
          title: data.title,
          body: data.body,
        },
      ],
      {
        title: data.title,
        body: data.body,
        url: "/account/notifications",
        urgency: "normal",
      },
    );

    return { ok: true, pushed: result.sent };
  });
