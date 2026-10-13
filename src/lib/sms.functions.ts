import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Owner → Settings → SMS/OTP provider configuration. Mirrors the existing
 * payment-provider pattern: non-secret configuration in the database, the API
 * key only in the server secret store, and presence/status flags (never the
 * key) returned to the browser.
 */

export interface SmsProviderView {
  id: string;
  provider: "alpha_sms" | "smsbd";
  isEnabled: boolean;
  senderId: string | null;
  note: string | null;
  apiKeySecretName: string;
  apiKeyStored: boolean;
  status: "disabled" | "not_configured" | "configured";
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

const toView = (
  config: Awaited<ReturnType<typeof import("@/lib/sms.server").getSmsConfig>>,
  secretName: string,
): SmsProviderView | null => {
  if (!config) return null;
  return {
    id: config.id,
    provider: config.provider,
    isEnabled: config.isEnabled,
    senderId: config.senderId,
    note: config.note,
    apiKeySecretName: secretName,
    apiKeyStored: config.apiKeyStored,
    status: !config.isEnabled
      ? "disabled"
      : config.apiKeyStored
        ? "configured"
        : "not_configured",
    lastTestAt: config.lastTestAt,
    lastTestOk: config.lastTestOk,
    lastTestMessage: config.lastTestMessage,
  };
};

export const ownerGetSmsProvider = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SmsProviderView | null> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings", "view");
    const { getSmsConfig, SMS_API_KEY_SECRET } = await import("@/lib/sms.server");
    return toView(await getSmsConfig(), SMS_API_KEY_SECRET);
  });

export const ownerSaveSmsProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        provider: z.enum(["alpha_sms", "smsbd"]),
        isEnabled: z.boolean(),
        senderId: z.string().trim().max(40).nullable(),
        note: z.string().trim().max(400).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");

    const { error } = await looseDb(supabaseAdmin)
      .from("sms_providers")
      .update({
        provider: data.provider,
        is_enabled: data.isEnabled,
        sender_id: data.senderId,
        note: data.note,
      })
      .eq("id", data.id);

    if (error) {
      console.error("SMS provider save failed", error.message);
      throw new Error("We couldn't save the SMS settings. Please try again.");
    }
    return { ok: true };
  });

/** Real provider call — never a "stored key means success" shortcut. */
export const ownerTestSmsConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; message: string }> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings");
    const { getSmsConfig, checkSmsConnection, recordConnectionTest } = await import(
      "@/lib/sms.server"
    );

    const config = await getSmsConfig();
    if (!config) return { ok: false, message: "SMS settings row is missing." };

    const result = await checkSmsConnection();
    await recordConnectionTest(config.id, result);
    return result;
  });
