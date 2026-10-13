import { createServerFn } from "@tanstack/react-start";

/**
 * Authentication mode, decided on the SERVER from the existing SMS/OTP provider
 * configuration (Owner → Settings row in `sms_providers` plus the server-only
 * API key). The browser receives one boolean — never the provider name, the
 * key, or any other credential.
 *
 * Mode 1 (smsVerificationRequired === false): no usable SMS provider, so phone
 * + password is enough to create and use an account.
 * Mode 2 (smsVerificationRequired === true): a real provider is enabled and its
 * key is stored, so the provider's own SMS OTP must be verified.
 */
export interface PhoneAuthMode {
  smsVerificationRequired: boolean;
}

export const getPhoneAuthMode = createServerFn({ method: "GET" }).handler(
  async (): Promise<PhoneAuthMode> => {
    try {
      const { getSmsConfig } = await import("@/lib/sms.server");
      const config = await getSmsConfig();
      return { smsVerificationRequired: Boolean(config?.isEnabled && config.apiKeyStored) };
    } catch {
      // Unreadable settings must not silently turn verification off in a way
      // that differs from what the rest of the app does: without a usable
      // provider no SMS can be delivered anyway, so Mode 1 is the honest answer.
      return { smsVerificationRequired: false };
    }
  },
);
