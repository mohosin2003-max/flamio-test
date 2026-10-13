import { supabase } from "@/integrations/supabase/client";

import { formatPhone } from "@/lib/phone";

/**
 * Real SMS OTP helpers. These call the project's authentication provider
 * directly — no simulated codes anywhere. When no SMS provider is configured
 * the provider returns an error, which we translate into a clear operator
 * message instead of pretending a code was sent.
 */

export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export const SMS_PROVIDER_REQUIRED_MESSAGE =
  "SMS verification isn't active yet. Turn on the SMS/OTP provider in Owner → Settings (and store its API key) before verification codes can be delivered.";

const UNAVAILABLE_PATTERNS = [
  /sms provider/i,
  /phone.*(not enabled|disabled|unsupported)/i,
  /unsupported phone provider/i,
  /provider is not enabled/i,
  /error sending (sms|confirmation)/i,
  /signups not allowed/i,
];

export function isOtpUnavailableError(message: string | null | undefined): boolean {
  if (!message) return false;
  return UNAVAILABLE_PATTERNS.some((re) => re.test(message));
}

export interface OtpResult {
  ok: boolean;
  /** true when the failure is a missing SMS provider configuration. */
  configurationRequired?: boolean;
  message?: string;
}

/** Sends a real OTP to the phone number. Never creates a new account. */
export async function sendPhoneOtp(rawPhone: string): Promise<OtpResult> {
  const phone = formatPhone(rawPhone);
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: false },
  });
  if (!error) return { ok: true };
  if (isOtpUnavailableError(error.message)) {
    return { ok: false, configurationRequired: true, message: SMS_PROVIDER_REQUIRED_MESSAGE };
  }
  if (/rate|too many|limit/i.test(error.message)) {
    return { ok: false, message: "Too many attempts. Please wait a minute and try again." };
  }
  return { ok: false, message: error.message };
}

/** Verifies a code the customer received by SMS. */
export async function verifyPhoneOtp(rawPhone: string, token: string): Promise<OtpResult> {
  const phone = formatPhone(rawPhone);
  const { error } = await supabase.auth.verifyOtp({ phone, token: token.trim(), type: "sms" });
  if (!error) return { ok: true };
  if (/expired/i.test(error.message)) {
    return { ok: false, message: "That code has expired. Request a new one." };
  }
  if (/invalid|incorrect/i.test(error.message)) {
    return { ok: false, message: "That code isn't correct. Please check and try again." };
  }
  if (isOtpUnavailableError(error.message)) {
    return { ok: false, configurationRequired: true, message: SMS_PROVIDER_REQUIRED_MESSAGE };
  }
  return { ok: false, message: error.message };
}

/**
 * Starts a real phone-change verification for the signed-in customer. The
 * provider sends the SMS; we never generate or check codes ourselves.
 */
export async function sendPhoneChangeOtp(rawPhone: string): Promise<OtpResult> {
  const phone = formatPhone(rawPhone);
  const { error } = await supabase.auth.updateUser({ phone });
  if (!error) return { ok: true };
  if (isOtpUnavailableError(error.message)) {
    return { ok: false, configurationRequired: true, message: SMS_PROVIDER_REQUIRED_MESSAGE };
  }
  if (/already|registered|exists/i.test(error.message)) {
    return { ok: false, message: "That phone number is already used by another account." };
  }
  if (/rate|too many|limit/i.test(error.message)) {
    return { ok: false, message: "Too many attempts. Please wait a minute and try again." };
  }
  return { ok: false, message: error.message };
}

/** Verifies the SMS code sent for a phone-number change. */
export async function verifyPhoneChangeOtp(rawPhone: string, token: string): Promise<OtpResult> {
  const phone = formatPhone(rawPhone);
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token: token.trim(),
    type: "phone_change",
  });
  if (!error) return { ok: true };
  if (/expired/i.test(error.message)) {
    return { ok: false, message: "That code has expired. Request a new one." };
  }
  if (/invalid|incorrect/i.test(error.message)) {
    return { ok: false, message: "That code isn't correct. Please check and try again." };
  }
  if (isOtpUnavailableError(error.message)) {
    return { ok: false, configurationRequired: true, message: SMS_PROVIDER_REQUIRED_MESSAGE };
  }
  return { ok: false, message: error.message };
}
