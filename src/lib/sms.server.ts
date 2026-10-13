/**
 * SMS delivery layer (server only).
 *
 * This module ONLY delivers messages. OTP generation, expiry, verification and
 * rate limiting stay entirely inside the existing authentication provider
 * (see `src/lib/otp.ts` and the auth SMS hook route) — nothing here creates a
 * second OTP system.
 *
 * The API key lives in the server secret store (`ALPHA_SMS_API_KEY`) and is
 * never stored in the database, returned to the browser, or logged.
 */

import { normalizePhone } from "@/lib/phone";

export const SMS_API_KEY_SECRET = "ALPHA_SMS_API_KEY";

const ENDPOINTS = {
  send: "https://api.sms.net.bd/sendsms",
  balance: "https://api.sms.net.bd/user/balance/",
} as const;

export type SmsProviderSlug = "alpha_sms" | "smsbd";

export interface SmsConfig {
  id: string;
  provider: SmsProviderSlug;
  isEnabled: boolean;
  senderId: string | null;
  note: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  /** Presence only — the value itself is never exposed. */
  apiKeyStored: boolean;
}

export interface SmsSendResult {
  ok: boolean;
  /** Safe, operator-facing message. Never contains credentials. */
  message: string;
}

const apiKey = (): string | null => process.env[SMS_API_KEY_SECRET] ?? null;

export async function getSmsConfig(): Promise<SmsConfig | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { looseDb } = await import("@/integrations/supabase/loose.server");

  const { data, error } = await looseDb(supabaseAdmin)
    .from("sms_providers")
    .select(
      "id, provider, is_enabled, sender_id, note, last_test_at, last_test_ok, last_test_message",
    )
    .eq("slug", "sms_otp")
    .maybeSingle();

  if (error) {
    console.error("SMS provider read failed", error.message);
    throw new Error("We couldn't load the SMS settings. Please try again.");
  }
  if (!data) return null;

  return {
    id: data.id as string,
    provider: (data.provider as SmsProviderSlug) ?? "alpha_sms",
    isEnabled: Boolean(data.is_enabled),
    senderId: (data.sender_id as string | null) ?? null,
    note: (data.note as string | null) ?? null,
    lastTestAt: (data.last_test_at as string | null) ?? null,
    lastTestOk: (data.last_test_ok as boolean | null) ?? null,
    lastTestMessage: (data.last_test_message as string | null) ?? null,
    apiKeyStored: Boolean(apiKey()),
  };
}

/** sms.net.bd expects a local Bangladeshi number without the + prefix. */
export function toProviderNumber(rawPhone: string): string | null {
  const digits = normalizePhone(rawPhone); // 8801XXXXXXXXX
  if (!/^8801\d{9}$/.test(digits)) return null;
  return digits;
}

interface ProviderResponse {
  error?: number | string;
  msg?: string;
}

const readProviderResponse = async (response: Response): Promise<ProviderResponse> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as ProviderResponse;
  } catch {
    return { error: 1, msg: response.ok ? "Unexpected provider response" : "Provider unavailable" };
  }
};

const friendlyProviderError = (msg: string | undefined): string => {
  const raw = (msg ?? "").toLowerCase();
  if (/api key|unauthor|authentic/.test(raw)) return "The SMS API key was rejected by the provider.";
  if (/balance|insufficient|credit/.test(raw)) return "The SMS account balance is too low to send.";
  if (/sender/.test(raw)) return "The sender ID is not approved by the provider.";
  if (/number|recipient|msisdn/.test(raw)) return "The phone number was rejected by the provider.";
  return msg && msg.length < 160 ? msg : "The SMS provider rejected the request.";
};

/**
 * Sends one SMS through the configured provider. Returns a result object —
 * it never throws provider internals at the caller.
 */
export async function sendSms(rawPhone: string, message: string): Promise<SmsSendResult> {
  let config: SmsConfig | null;
  try {
    config = await getSmsConfig();
  } catch {
    return { ok: false, message: "SMS settings are unavailable right now." };
  }

  if (!config || !config.isEnabled) {
    return { ok: false, message: "The SMS provider is turned off in Owner settings." };
  }
  const key = apiKey();
  if (!key) {
    return { ok: false, message: "No SMS API key is configured on the server." };
  }
  const to = toProviderNumber(rawPhone);
  if (!to) {
    return { ok: false, message: "That phone number isn't a valid Bangladeshi mobile number." };
  }

  const form = new FormData();
  form.set("api_key", key);
  form.set("msg", message);
  form.set("to", to);
  if (config.senderId) form.set("sender_id", config.senderId);

  try {
    const response = await fetch(ENDPOINTS.send, { method: "POST", body: form });
    const payload = await readProviderResponse(response);
    if (Number(payload.error ?? 1) === 0) {
      return { ok: true, message: "SMS submitted to the provider." };
    }
    console.error("SMS send rejected", { status: response.status, msg: payload.msg });
    return { ok: false, message: friendlyProviderError(payload.msg) };
  } catch (error) {
    console.error("SMS send failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Couldn't reach the SMS provider. Please try again." };
  }
}

/**
 * Real connection check: asks the provider for the account balance using the
 * stored key. No SMS is sent and no credential is returned.
 */
export async function checkSmsConnection(): Promise<SmsSendResult> {
  const key = apiKey();
  if (!key) return { ok: false, message: "No SMS API key is configured on the server yet." };

  try {
    const response = await fetch(`${ENDPOINTS.balance}?api_key=${encodeURIComponent(key)}`);
    const payload = (await readProviderResponse(response)) as ProviderResponse & {
      data?: { balance?: string | number };
    };
    if (Number(payload.error ?? 1) === 0) {
      const balance = payload.data?.balance;
      return {
        ok: true,
        message:
          balance === undefined
            ? "Connected to the SMS provider."
            : `Connected. Provider balance: ${String(balance)}.`,
      };
    }
    return { ok: false, message: friendlyProviderError(payload.msg) };
  } catch (error) {
    console.error("SMS connection test failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Couldn't reach the SMS provider." };
  }
}

/** Production-safe OTP text. No personal details beyond the code itself. */
export function otpMessage(code: string): string {
  return `Your Flamio verification code is ${code}. Do not share this code with anyone.`;
}

export async function recordConnectionTest(id: string, result: SmsSendResult): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { looseDb } = await import("@/integrations/supabase/loose.server");
  await looseDb(supabaseAdmin)
    .from("sms_providers")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_ok: result.ok,
      last_test_message: result.message,
    })
    .eq("id", id);
}
