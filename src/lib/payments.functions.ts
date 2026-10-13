import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Payment configuration FOUNDATION only.
 *
 * - This module stores NON-SECRET configuration only (enabled flag, test/live
 *   mode, a public merchant reference, a note). API keys, app secrets and
 *   passwords are NEVER stored in the database and NEVER returned to the
 *   browser — they live in the server secret store and are read inside server
 *   handlers when a real integration is built.
 * - Nothing here touches checkout, orders or the existing Cash flow. Online
 *   payment stays unavailable at checkout until a real integration exists.
 */

/** Secret names a future bKash integration will read server-side. */
export const BKASH_SECRET_NAMES = [
  "BKASH_APP_KEY",
  "BKASH_APP_SECRET",
  "BKASH_USERNAME",
  "BKASH_PASSWORD",
] as const;

export type ProviderStatus = "disabled" | "not_configured" | "configured";

export interface PaymentProviderRow {
  id: string;
  slug: string;
  label: string;
  isEnabled: boolean;
  mode: "sandbox" | "live";
  merchantReference: string | null;
  note: string | null;
  /** Names only — never values. */
  requiredSecretNames: string[];
  /** Which required secrets are present on the server. Booleans only. */
  missingSecretNames: string[];
  credentialsReady: boolean;
  status: ProviderStatus;
  liveIntegrationAvailable: boolean;
}

const requiredSecretsFor = (slug: string): string[] =>
  slug === "bkash" ? [...BKASH_SECRET_NAMES] : [];

export const ownerListPaymentProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentProviderRow[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings", "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("payment_providers")
      .select("id, slug, label, is_enabled, mode, merchant_reference, note, sort_order")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Payment provider list failed", error);
      throw new Error("We couldn't load payment settings. Please try again.");
    }

    return (data ?? []).map((row) => {
      const required = requiredSecretsFor(row.slug);
      // Presence check only — values are never read into the response.
      const missing = required.filter((name) => !process.env[name]);
      const isCash = row.slug === "cash";
      const credentialsReady = isCash ? true : required.length > 0 && missing.length === 0;
      const status: ProviderStatus = !row.is_enabled
        ? "disabled"
        : credentialsReady
          ? "configured"
          : "not_configured";

      return {
        id: row.id,
        slug: row.slug,
        label: row.label,
        isEnabled: row.is_enabled,
        mode: row.mode === "live" ? "live" : "sandbox",
        merchantReference: row.merchant_reference,
        note: row.note,
        requiredSecretNames: required,
        missingSecretNames: missing,
        credentialsReady,
        status,
        // Only Cash has a real, implemented payment flow today.
        liveIntegrationAvailable: isCash,
      };
    });
  });

export const ownerSavePaymentProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        isEnabled: z.boolean(),
        mode: z.enum(["sandbox", "live"]),
        merchantReference: z.string().trim().max(80).nullable(),
        note: z.string().trim().max(400).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "settings");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("payment_providers")
      .update({
        is_enabled: data.isEnabled,
        mode: data.mode,
        merchant_reference: data.merchantReference,
        note: data.note,
      })
      .eq("id", data.id);

    if (error) {
      console.error("Payment provider save failed", error);
      throw new Error("We couldn't save this payment provider. Please try again.");
    }

    return { ok: true };
  });
