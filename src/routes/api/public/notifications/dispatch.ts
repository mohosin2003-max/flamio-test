import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled notification dispatcher. Called once a minute by the database
 * scheduler with the platform cron secret; it claims due jobs atomically and
 * sends the delayed review reminders and staff/owner escalations.
 */
export const Route = createFileRoute("/api/public/notifications/dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        // Scheduled pre-orders become normal "placed" orders at
        // scheduled time minus preparation time; the database then queues the
        // existing staff new-order alert, which is sent just below.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await (
            supabaseAdmin as unknown as { rpc: (fn: string) => Promise<{ error: unknown }> }
          ).rpc("activate_due_scheduled_orders");
          if (error) console.error("Scheduled order activation failed", error);
        } catch (activationError) {
          console.error("Scheduled order activation failed", activationError);
        }

        // Attendance: close normal duty at shift end and open/close approved
        // overtime windows. Server clock only; safe to run repeatedly.
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { error } = await (
            supabaseAdmin as unknown as { rpc: (fn: string) => Promise<{ error: unknown }> }
          ).rpc("attendance_run_duty_maintenance");
          if (error) console.error("Attendance duty maintenance failed", error);
        } catch (maintenanceError) {
          console.error("Attendance duty maintenance failed", maintenanceError);
        }

        const { dispatchDueNotificationJobs } = await import("@/lib/push.server");
        const result = await dispatchDueNotificationJobs(25);

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
