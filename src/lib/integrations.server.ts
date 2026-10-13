/**
 * Communication integrations (server only) — WhatsApp Business and Email.
 *
 * These reuse the EXISTING provider-configuration table `public.sms_providers`
 * (one row per slug, non-secret configuration only). The existing SMS/OTP row
 * and everything that reads it are untouched; its own owner screen stays where
 * it is. Credentials live exclusively in the server secret store and are never
 * returned to the browser — only presence flags and safe status text.
 */

export type IntegrationSlug = "whatsapp" | "email";

/** Only the states the implementation can actually produce. */
export type IntegrationStatus =
  | "not_configured"
  | "configuration_required"
  | "active"
  | "disabled"
  | "error";

/** Secret names each provider needs. Values are never read into a response. */
export const INTEGRATION_SECRETS: Record<IntegrationSlug, string[]> = {
  whatsapp: ["WHATSAPP_ACCESS_TOKEN"],
  email: ["RESEND_API_KEY"],
};

/** Non-secret configuration fields the owner fills in. */
export const INTEGRATION_FIELDS: Record<
  IntegrationSlug,
  { key: string; label: string; hint?: string; required: boolean }[]
> = {
  whatsapp: [
    { key: "phoneNumberId", label: "WhatsApp phone number ID", required: true },
    { key: "businessAccountId", label: "WhatsApp business account ID", required: false },
    { key: "displayName", label: "Business display name", required: false },
  ],
  email: [
    { key: "fromEmail", label: "Sender email address", required: true },
    { key: "fromName", label: "Sender name", required: false },
  ],
};

export interface IntegrationConfig {
  id: string;
  slug: IntegrationSlug;
  channel: "whatsapp" | "email";
  provider: string;
  isEnabled: boolean;
  config: Record<string, string>;
  note: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  missingSecretNames: string[];
  secretNames: string[];
  missingFields: string[];
  status: IntegrationStatus;
}

const db = async () => {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return untypedAdmin();
};

const secretPresent = (name: string): boolean => Boolean(process.env[name]);

function computeStatus(row: {
  isEnabled: boolean;
  missingSecretNames: string[];
  missingFields: string[];
  lastTestOk: boolean | null;
}): IntegrationStatus {
  const incomplete = row.missingSecretNames.length > 0 || row.missingFields.length > 0;
  if (incomplete) return row.isEnabled ? "configuration_required" : "not_configured";
  if (!row.isEnabled) return row.lastTestOk === false ? "error" : "disabled";
  if (row.lastTestOk === true) return "active";
  if (row.lastTestOk === false) return "error";
  // Enabled and fully configured, but never tested successfully.
  return "configuration_required";
}

export async function listIntegrations(): Promise<IntegrationConfig[]> {
  const client = await db();
  const { data, error } = await client
    .from("sms_providers")
    .select("id, slug, provider, channel, is_enabled, config, note, last_test_at, last_test_ok, last_test_message")
    .in("slug", ["whatsapp", "email"]);

  if (error) {
    console.error("Integration list failed", error.message);
    throw new Error("We couldn't load the integration settings. Please try again.");
  }

  return (data ?? [])
    .map((row: Record<string, unknown>): IntegrationConfig => {
      const slug = row['slug'] as IntegrationSlug;
      const config = (row['config'] as Record<string, string> | null) ?? {};
      const secretNames = INTEGRATION_SECRETS[slug] ?? [];
      const missingSecretNames = secretNames.filter((name) => !secretPresent(name));
      const missingFields = (INTEGRATION_FIELDS[slug] ?? [])
        .filter((field) => field.required && !String(config[field.key] ?? "").trim())
        .map((field) => field.label);
      const isEnabled = Boolean(row['is_enabled']);
      const lastTestOk = (row['last_test_ok'] as boolean | null) ?? null;

      return {
        id: row['id'] as string,
        slug,
        channel: slug === "whatsapp" ? "whatsapp" : "email",
        provider: (row['provider'] as string) ?? "",
        isEnabled,
        config,
        note: (row['note'] as string | null) ?? null,
        lastTestAt: (row['last_test_at'] as string | null) ?? null,
        lastTestOk,
        lastTestMessage: (row['last_test_message'] as string | null) ?? null,
        secretNames,
        missingSecretNames,
        missingFields,
        status: computeStatus({ isEnabled, missingSecretNames, missingFields, lastTestOk }),
      };
    })
    .sort((a: IntegrationConfig, b: IntegrationConfig) => a.slug.localeCompare(b.slug));
}

export async function getIntegration(slug: IntegrationSlug): Promise<IntegrationConfig | null> {
  const all = await listIntegrations();
  return all.find((row) => row.slug === slug) ?? null;
}

export async function saveIntegration(input: {
  slug: IntegrationSlug;
  isEnabled: boolean;
  config: Record<string, string>;
  note: string | null;
}): Promise<void> {
  const client = await db();
  const { error } = await client
    .from("sms_providers")
    .update({ is_enabled: input.isEnabled, config: input.config, note: input.note })
    .eq("slug", input.slug);
  if (error) {
    console.error("Integration save failed", error.message);
    throw new Error("We couldn't save this integration. Please try again.");
  }
}

export async function recordIntegrationTest(
  slug: IntegrationSlug,
  result: { ok: boolean; message: string },
): Promise<void> {
  const client = await db();
  await client
    .from("sms_providers")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_test_message: result.message,
    })
    .eq("slug", slug);
}

/**
 * Real provider connection checks. Neither sends a message to anybody: WhatsApp
 * reads the configured phone number, Email reads the account's domains.
 */
export async function testIntegration(
  slug: IntegrationSlug,
): Promise<{ ok: boolean; message: string }> {
  const row = await getIntegration(slug);
  if (!row) return { ok: false, message: "This integration isn't set up yet." };
  if (row.missingSecretNames.length > 0) {
    return { ok: false, message: "The access credential isn't stored on the server yet." };
  }
  if (row.missingFields.length > 0) {
    return { ok: false, message: `Still needed: ${row.missingFields.join(", ")}.` };
  }

  try {
    if (slug === "whatsapp") {
      const id = encodeURIComponent(row.config['phoneNumberId'] ?? "");
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${id}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${process.env["WHATSAPP_ACCESS_TOKEN"]}` } },
      );
      const payload = (await response.json().catch(() => null)) as
        | { display_phone_number?: string; verified_name?: string; error?: { message?: string } }
        | null;
      if (!response.ok) {
        console.error("WhatsApp test failed", response.status, payload?.error?.message);
        return { ok: false, message: safeProviderMessage(payload?.error?.message, response.status) };
      }
      const name = payload?.verified_name ?? "WhatsApp Business";
      return { ok: true, message: `Connected to ${name} (${payload?.display_phone_number ?? "number verified"}).` };
    }

    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${process.env["RESEND_API_KEY"]}` },
    });
    const payload = (await response.json().catch(() => null)) as { message?: string } | null;
    if (!response.ok) {
      console.error("Email test failed", response.status, payload?.message);
      return { ok: false, message: safeProviderMessage(payload?.message, response.status) };
    }
    return { ok: true, message: "Connected to the email provider." };
  } catch (error) {
    console.error("Integration test failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Couldn't reach the provider. Please try again." };
  }
}

function safeProviderMessage(raw: string | undefined, status: number): string {
  if (status === 401 || status === 403) return "The stored credential was rejected by the provider.";
  if (status === 404) return "The provider couldn't find the configured account or number.";
  if (raw && raw.length < 160) return raw;
  return "The provider rejected the connection test.";
}
