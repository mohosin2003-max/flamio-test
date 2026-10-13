import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";
import { isValidPhone, normalizePhone, phoneToAuthEmail } from "@/lib/phone";
import { callerKey, createRateLimiter } from "@/lib/rate-limit.server";

/**
 * Abuse protection for the public phone/password endpoints below, keyed on
 * the caller IP. These functions proxy to Supabase Auth from the server, so
 * Supabase's own per-IP limits see only the server — this app-side limit is
 * what slows a single attacker and keeps one caller from tripping the
 * server-wide Supabase limit. Best-effort per-worker memory; see
 * rate-limit.server.ts.
 *
 * Login counts FAILED attempts only (10/hour): a successful sign-in never
 * consumes the limit, so legitimate customers are never blocked by their own
 * good logins. Signup counts every attempt (5/hour): a genuine customer
 * creates one account, so this stays far above normal use.
 */
const loginLimiter = createRateLimiter(10);
const signupLimiter = createRateLimiter(5);

const TOO_MANY_LOGINS = "Too many login attempts. Please try again later.";
const TOO_MANY_SIGNUPS = "Too many signup attempts. Please try again later.";

type LoginResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; message: string };

type SignUpResult =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; requiresOtp?: boolean; message: string };

/** Server-side authentication mode. Never trusted from the browser. */
async function smsVerificationRequired(): Promise<boolean> {
  try {
    const { getSmsConfig } = await import("@/lib/sms.server");
    const config = await getSmsConfig();
    return Boolean(config?.isEnabled && config.apiKeyStored);
  } catch {
    return false;
  }
}

function publicAuthClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/**
 * Compatibility login for accounts whose real auth email differs from the
 * phone stored in their profile. It never returns the mapped email or logs the
 * password; the existing auth provider still validates the credentials.
 */
export const signInWithPhonePassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ identity: z.string().trim().min(3).max(160), password: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data }): Promise<LoginResult> => {
    const caller = callerKey();
    // Refuse before touching the database. The message is generic and does
    // not reveal whether the phone/email exists.
    if (loginLimiter.isLimited(caller)) {
      return { ok: false, message: TOO_MANY_LOGINS };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const isEmail = data.identity.includes("@");
    const identity = isEmail ? data.identity.toLowerCase() : normalizePhone(data.identity);
    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq(isEmail ? "email" : "phone", identity)
      .limit(2);

    if (error || profiles?.length !== 1) {
      loginLimiter.record(caller);
      return { ok: false, message: "Incorrect email/phone or password." };
    }

    const profile = profiles[0];
    if (!profile) {
      loginLimiter.record(caller);
      return { ok: false, message: "Incorrect email/phone or password." };
    }

    const { data: authUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(profile.id);
    const email = authUser.user?.email;
    if (userError || !email) {
      loginLimiter.record(caller);
      return { ok: false, message: "Incorrect email/phone or password." };
    }

    // When a real SMS provider is active, this compatibility path must never
    // let an account with an unverified phone number in.
    if (authUser.user?.phone && !authUser.user.phone_confirmed_at && (await smsVerificationRequired())) {
      loginLimiter.record(caller);
      return {
        ok: false,
        message: "Please verify your phone number with the code we sent before signing in.",
      };
    }


    const { data: signedIn, error: signInError } = await publicAuthClient().auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (signInError || !signedIn.session) {
      loginLimiter.record(caller);
      return { ok: false, message: "Incorrect email/phone or password." };
    }

    return {
      ok: true,
      accessToken: signedIn.session.access_token,
      refreshToken: signedIn.session.refresh_token,
    };
  });

/**
 * Mode 1 signup: phone + password only, used when the project has no usable SMS
 * OTP provider. The phone number stays the primary login identifier; the auth
 * record uses the existing deterministic phone-derived address so one phone maps
 * to exactly one account. When a real SMS provider IS active this refuses and
 * tells the caller to use the provider's own OTP flow instead.
 */
export const signUpWithPhonePassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        fullName: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(6).max(30),
        password: z.string().min(8).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SignUpResult> => {
    // Count every signup attempt per caller before doing any work. The
    // message is generic and reveals nothing about existing accounts.
    if (signupLimiter.checkAndRecord(callerKey())) {
      return { ok: false, message: TOO_MANY_SIGNUPS };
    }
    if (!isValidPhone(data.phone)) {
      return { ok: false, message: "Please enter a valid phone number." };
    }
    if (await smsVerificationRequired()) {
      return {
        ok: false,
        requiresOtp: true,
        message: "Phone verification is required. Please use the code sent to your phone.",
      };
    }

    const phone = normalizePhone(data.phone);
    const authEmail = phoneToAuthEmail(phone);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", phone)
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: false, message: "An account with this phone number already exists. Please sign in." };
    }

    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, phone },
    });
    if (createError || !created.user) {
      if (createError && /already|registered|exists/i.test(createError.message)) {
        return { ok: false, message: "An account with this phone number already exists. Please sign in." };
      }
      console.error("Phone signup failed", createError?.message);
      return { ok: false, message: "We couldn't create your account. Please try again." };
    }

    await supabaseAdmin
      .from("profiles")
      .upsert({ id: created.user.id, full_name: data.fullName, phone }, { onConflict: "id" });

    const { data: signedIn, error: signInError } = await publicAuthClient().auth.signInWithPassword({
      email: authEmail,
      password: data.password,
    });
    if (signInError || !signedIn.session) {
      return { ok: false, message: "Account created. Please sign in with your phone number and password." };
    }

    return {
      ok: true,
      accessToken: signedIn.session.access_token,
      refreshToken: signedIn.session.refresh_token,
    };
  });