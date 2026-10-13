import { createFileRoute } from "@tanstack/react-router";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled data cleanup. Called by the database scheduler with the existing
 * platform cron secret — the same mechanism the notification dispatcher uses.
 * It only removes what the owner enabled, and never runs while automatic
 * cleanup is paused or waiting for approval.
 */
export const Route = createFileRoute("/api/public/cleanup/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { runScheduledCleanup } = await import("@/lib/cleanup.server");
        const result = await runScheduledCleanup();

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
