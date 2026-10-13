import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Owner → Settings → Integrations. Same shape as the existing payment and SMS
 * sections: non-secret configuration in the database, credentials only in the
 * server secret store, and presence/status flags (never a credential) returned.
 */

export interface IntegrationView {
  id: string;
  slug: "whatsapp" | "email";
  channel: "whatsapp" | "email";
  provider: string;
  isEnabled: boolean;
  config: Record<string, string>;
  note: string | null;
  status: "not_configured" | "configuration_required" | "active" | "disabled" | "error";
  secretNames: string[];
  missingSecretNames: string[];
  missingFields: string[];
  fields: { key: string; label: string; required: boolean }[];
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export const ownerListIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IntegrationView[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "integrations", "view");
    const { listIntegrations, INTEGRATION_FIELDS } = await import("@/lib/integrations.server");

    return (await listIntegrations()).map((row) => ({
      id: row.id,
      slug: row.slug,
      channel: row.channel,
      provider: row.provider,
      isEnabled: row.isEnabled,
      config: row.config,
      note: row.note,
      status: row.status,
      secretNames: row.secretNames,
      missingSecretNames: row.missingSecretNames,
      missingFields: row.missingFields,
      fields: (INTEGRATION_FIELDS[row.slug] ?? []).map((field) => ({
        key: field.key,
        label: field.label,
        required: field.required,
      })),
      lastTestAt: row.lastTestAt,
      lastTestOk: row.lastTestOk,
      lastTestMessage: row.lastTestMessage,
    }));
  });

export const ownerSaveIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.enum(["whatsapp", "email"]),
        isEnabled: z.boolean(),
        config: z.record(z.string(), z.string().trim().max(200)),
        note: z.string().trim().max(400).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "integrations");
    const { saveIntegration } = await import("@/lib/integrations.server");
    await saveIntegration(data);
    return { ok: true };
  });

/** Real provider call — never a "credential exists so it must work" shortcut. */
export const ownerTestIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ slug: z.enum(["whatsapp", "email"]) }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; message: string }> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "integrations");
    const { testIntegration, recordIntegrationTest } = await import("@/lib/integrations.server");
    const result = await testIntegration(data.slug);
    await recordIntegrationTest(data.slug, result);
    return result;
  });
