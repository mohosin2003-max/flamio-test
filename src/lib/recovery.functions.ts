import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { normalizePhone } from "@/lib/phone";

/**
 * Password recovery. Priority, decided on the server:
 *  1. account has a real email  → Supabase email recovery code (never SMS)
 *  2. no email + SMS provider usable + phone on the auth record → Supabase SMS code
 *  3. otherwise → owner-approved one-time recovery code (manual fallback)
 * Passwords are only ever set by the customer; staff never see or set them.
 */

export type RecoveryMethod =
  | { method: "email"; maskedEmail: string }
  | { method: "sms"; maskedPhone: string }
  | { method: "manual" };

const PHONE_AUTH_DOMAIN = "@phone.flamio.app";
const CODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_REQUESTS_PER_DAY = 3;
const GENERIC_FAIL = "That code is not valid or has expired.";

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

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

function maskPhone(phone: string): string {
  return `+${phone.slice(0, 3)}******${phone.slice(-3)}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type Account = { id: string; phone: string | null; email: string | null; authPhone: string | null };

/**
 * Read-only fallback: finds the auth user whose login email matches exactly.
 * Used only when no profile row carries that email. Bounded page scan.
 */
async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  if (email.endsWith(PHONE_AUTH_DOMAIN)) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const match = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

/** Resolves an account by phone or email. Returns null when there is no single match. */
async function findAccount(identity: string): Promise<Account | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const isEmail = identity.includes("@");
  const value = isEmail ? identity.trim().toLowerCase() : normalizePhone(identity);
  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, phone")
    .eq(isEmail ? "email" : "phone", value)
    .limit(2);
  let userId: string | null = null;
  let profilePhone: string | null = null;
  if (profiles && profiles.length === 1 && profiles[0]) {
    userId = profiles[0].id;
    profilePhone = profiles[0].phone;
  } else if (isEmail && (!profiles || profiles.length === 0)) {
    userId = await findAuthUserIdByEmail(value);
    if (userId) {
      const { data: p } = await supabaseAdmin.from("profiles").select("phone").eq("id", userId).maybeSingle();
      profilePhone = p?.phone ?? null;
    }
  }
  if (!userId) return null;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const user = data.user;
  if (!user) return null;
  // When the account was found by email, that email must be its real login email.
  if (isEmail && (user.email ?? "").toLowerCase() !== value) return null;
  const email = user.email && !user.email.endsWith(PHONE_AUTH_DOMAIN) ? user.email : null;
  return {
    id: user.id,
    phone: profilePhone ? normalizePhone(profilePhone) : null,
    email,
    authPhone: user.phone || null,
  };
}

async function smsUsable(): Promise<boolean> {
  try {
    const { getSmsConfig } = await import("@/lib/sms.server");
    const config = await getSmsConfig();
    return Boolean(config?.isEnabled && config.apiKeyStored);
  } catch {
    return false;
  }
}

async function methodFor(account: Account | null): Promise<RecoveryMethod> {
  if (account?.email) return { method: "email", maskedEmail: maskEmail(account.email) };
  if (account?.authPhone && (await smsUsable())) {
    return { method: "sms", maskedPhone: maskPhone(normalizePhone(account.authPhone)) };
  }
  return { method: "manual" };
}

const identitySchema = z.object({ identity: z.string().trim().min(3).max(160) });
const passwordSchema = z.string().min(8).max(200);

/**
 * Abuse protection for the public lookup/send endpoints — same per-worker
 * in-memory sliding-window pattern as checkSignupDuplicates (best-effort,
 * no database table). Limited callers get the same generic responses an
 * unregistered identity gets, so nothing reveals account existence.
 */
const RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RL_MAX_TRACKED_KEYS = 5000;
const LOOKUP_PER_IP = 10;
const SEND_PER_IP = 10;
const SEND_PER_IDENTITY = 3;
const rlLog = new Map<string, number[]>();

function rlCallerIp(): string {
  try {
    const headers = getRequest()?.headers;
    if (!headers) return "unknown";
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const first = headers.get("x-forwarded-for")?.split(",")[0];
    return first ? first.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

function rlHit(key: string, max: number): boolean {
  const now = Date.now();
  if (rlLog.size > RL_MAX_TRACKED_KEYS) rlLog.clear();
  const recent = (rlLog.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (recent.length >= max) {
    rlLog.set(key, recent);
    return true;
  }
  recent.push(now);
  rlLog.set(key, recent);
  return false;
}

function identityKey(identity: string): string {
  return identity.includes("@") ? identity.toLowerCase() : normalizePhone(identity);
}

const SEND_LIMITED = "Too many attempts. Please try again later or request manual recovery.";

export const lookupRecovery = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }): Promise<RecoveryMethod> => {
    if (rlHit(`lookup:${rlCallerIp()}`, LOOKUP_PER_IP)) return { method: "manual" };
    return methodFor(await findAccount(data.identity));
  });

/** Sends the recovery code through whichever channel the server chooses. */
export const sendRecoveryCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => identitySchema.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    if (rlHit(`send-ip:${rlCallerIp()}`, SEND_PER_IP)) return { ok: false, message: SEND_LIMITED };
    if (rlHit(`send-id:${identityKey(data.identity)}`, SEND_PER_IDENTITY)) {
      return { ok: false, message: SEND_LIMITED };
    }
    const account = await findAccount(data.identity);
    const method = await methodFor(account);
    if (!account || method.method === "manual") return { ok: false, message: "Use a recovery request instead." };
    const client = publicAuthClient();
    if (method.method === "email") {
      const { error } = await client.auth.resetPasswordForEmail(account.email!);
      if (error) return { ok: false, message: "We couldn't send the email right now. Please try again shortly." };
      return { ok: true };
    }
    const { error } = await client.auth.signInWithOtp({
      phone: `+${normalizePhone(account.authPhone!)}`,
      options: { shouldCreateUser: false },
    });
    if (error) return { ok: false, message: "We couldn't send an SMS right now. You can request manual recovery." };
    return { ok: true };
  });

/** Verifies the provider's email/SMS code, then sets the customer's new password. */
export const resetWithProviderCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    identitySchema.extend({ code: z.string().trim().min(4).max(10), password: passwordSchema }).parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const account = await findAccount(data.identity);
    const method = await methodFor(account);
    if (!account || method.method === "manual") return { ok: false, message: GENERIC_FAIL };
    const client = publicAuthClient();
    const verified =
      method.method === "email"
        ? await client.auth.verifyOtp({ email: account.email!, token: data.code, type: "recovery" })
        : await client.auth.verifyOtp({
            phone: `+${normalizePhone(account.authPhone!)}`,
            token: data.code,
            type: "sms",
          });
    if (verified.error || !verified.data.user || verified.data.user.id !== account.id) {
      return { ok: false, message: GENERIC_FAIL };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(account.id, { password: data.password });
    if (error) return { ok: false, message: "We couldn't save the new password. Please try again." };
    await client.auth.signOut().catch(() => undefined);
    return { ok: true };
  });

async function recoveryTable() {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return (await untypedAdmin()).from("password_recovery_requests");
}

async function expireStale(userId?: string) {
  let q = (await recoveryTable())
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "approved")
    .lt("expires_at", new Date().toISOString());
  if (userId) q = q.eq("user_id", userId);
  await q;
}

async function notifyRecoveryStaff(phone: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["owner", "admin"]);
  const { data: staff } = await supabaseAdmin
    .from("staff_permissions")
    .select("user_id")
    .eq("permission", "account_recovery");
  const ids = new Set<string>([
    ...(roles ?? []).map((r) => r.user_id as string),
    ...(staff ?? []).map((r) => r.user_id as string),
  ]);
  if (ids.size === 0) return;
  await supabaseAdmin.from("notifications").insert(
    [...ids].map((user_id) => ({
      user_id,
      title: "Password recovery request",
      body: `A customer (${maskPhone(phone)}) asked for help resetting their password. Review it in Account recovery.`,
    })),
  );
}

const REQUEST_ACK =
  "Request received. Our team will call you to verify your identity, then give you a one-time recovery code.";

/** Phone-only fallback: creates one pending request and alerts the recovery team. */
export const requestManualRecovery = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ phone: z.string().trim().min(6).max(30) }).parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; message: string }> => {
    const phone = normalizePhone(data.phone);
    const account = await findAccount(phone);
    // Same answer whether or not the account exists (no enumeration).
    if (!account) return { ok: true, message: REQUEST_ACK };
    const method = await methodFor(account);
    if (method.method === "email") {
      return { ok: false, message: "This account has an email. Please use email recovery instead." };
    }

    await expireStale(account.id);
    const table = await recoveryTable();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await (await recoveryTable())
      .select("id", { count: "exact", head: true })
      .eq("user_id", account.id)
      .gte("requested_at", since);
    if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) {
      return { ok: false, message: "Too many recovery requests today. Please try again tomorrow." };
    }
    const { data: open } = await (await recoveryTable())
      .select("id, status")
      .eq("user_id", account.id)
      .in("status", ["pending", "approved"])
      .limit(1);
    if (open && open.length > 0) {
      return {
        ok: true,
        message:
          open[0].status === "approved"
            ? "Your request is already approved. Enter the recovery code our team gave you."
            : "You already have a pending request. Our team will contact you soon.",
      };
    }
    const { error } = await table.insert({ user_id: account.id, phone });
    if (error) {
      console.error("Recovery request failed", error.message);
      return { ok: false, message: "We couldn't save your request. Please try again." };
    }
    await notifyRecoveryStaff(phone).catch((e) => console.error("Recovery notify failed", e));
    return { ok: true, message: REQUEST_ACK };
  });

/** Customer redeems the owner-issued one-time code and sets their own password. */
export const redeemRecoveryCode = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().trim().min(6).max(30),
        code: z.string().trim().min(6).max(20),
        password: passwordSchema,
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const account = await findAccount(normalizePhone(data.phone));
    if (!account) return { ok: false, message: GENERIC_FAIL };
    await expireStale(account.id);
    const { data: rows } = await (await recoveryTable())
      .select("id, code_hash, attempts, expires_at")
      .eq("user_id", account.id)
      .eq("status", "approved")
      .limit(1);
    const request = rows?.[0];
    if (!request?.code_hash || new Date(request.expires_at).getTime() < Date.now()) {
      return { ok: false, message: GENERIC_FAIL };
    }
    const hash = await sha256(data.code.toUpperCase().replace(/\s+/g, ""));
    if (hash !== request.code_hash) {
      const attempts = (request.attempts ?? 0) + 1;
      await (await recoveryTable())
        .update({
          attempts,
          status: attempts >= MAX_CODE_ATTEMPTS ? "locked" : "approved",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      return {
        ok: false,
        message:
          attempts >= MAX_CODE_ATTEMPTS
            ? "Too many wrong attempts. This code is now locked — please request recovery again."
            : GENERIC_FAIL,
      };
    }
    // Burn the code first (single use even under concurrent attempts).
    const now = new Date().toISOString();
    const { data: burned } = await (await recoveryTable())
      .update({ status: "used", used_at: now, code_hash: null, updated_at: now })
      .eq("id", request.id)
      .eq("status", "approved")
      .select("id");
    if (!burned || burned.length !== 1) return { ok: false, message: GENERIC_FAIL };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(account.id, { password: data.password });
    if (error) {
      console.error("Recovery password update failed", error.message);
      return { ok: false, message: "We couldn't save the new password. Please request recovery again." };
    }
    return { ok: true };
  });

// ---------- Owner / recovery staff ----------

export type RecoveryRequestRow = {
  id: string;
  phone: string;
  status: string;
  requestedAt: string;
  approvedAt: string | null;
  expiresAt: string | null;
  usedAt: string | null;
  attempts: number;
  customerName: string | null;
  accountCreatedAt: string | null;
  orderCount: number;
};

export const listRecoveryRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RecoveryRequestRow[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "account_recovery", "view");
    await expireStale();
    const { data: rows, error } = await (await recoveryTable())
      .select("id, user_id, phone, status, requested_at, approved_at, expires_at, used_at, attempts")
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Account recovery isn't set up yet. Please run the recovery database update.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type Row = {
      id: string; user_id: string; phone: string; status: string; requested_at: string;
      approved_at: string | null; expires_at: string | null; used_at: string | null; attempts: number | null;
    };
    const typed = (rows ?? []) as Row[];
    const ids: string[] = [...new Set(typed.map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, created_at").in("id", ids)
      : { data: [] as { id: string; full_name: string | null; created_at: string }[] };
    const counts = new Map<string, number>();
    for (const id of ids) {
      const { count } = await supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("user_id", id);
      counts.set(id, count ?? 0);
    }
    return typed.map((r) => {
      const p = (profiles ?? []).find((x) => x.id === r.user_id);
      return {
        id: r.id,
        phone: r.phone,
        status: r.status,
        requestedAt: r.requested_at,
        approvedAt: r.approved_at ?? null,
        expiresAt: r.expires_at ?? null,
        usedAt: r.used_at ?? null,
        attempts: r.attempts ?? 0,
        customerName: p?.full_name ?? null,
        accountCreatedAt: p?.created_at ?? null,
        orderCount: counts.get(r.user_id) ?? 0,
      };
    });
  });

/** Approve after verifying identity by phone. Returns the code ONCE; only its hash is stored. */
export const approveRecoveryRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ code: string; expiresAt: string }> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "account_recovery", "manage");
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
    const { data: updated, error } = await (await recoveryTable())
      .update({
        status: "approved",
        code_hash: await sha256(code),
        attempts: 0,
        approved_by: context.userId,
        approved_at: now.toISOString(),
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id");
    if (error || !updated || updated.length !== 1) throw new Error("This request is no longer pending.");
    return { code, expiresAt };
  });

export const rejectRecoveryRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "account_recovery", "manage");
    const now = new Date().toISOString();
    const { data: updated } = await (await recoveryTable())
      .update({ status: "rejected", code_hash: null, rejected_by: context.userId, rejected_at: now, updated_at: now })
      .eq("id", data.id)
      .in("status", ["pending", "approved"])
      .select("id");
    if (!updated || updated.length !== 1) throw new Error("This request can't be rejected any more.");
    return { ok: true };
  });
