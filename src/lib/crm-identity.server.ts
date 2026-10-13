/**
 * Customer CRM (Phase 2) — identity foundation. Server-only.
 *
 * One CRM customer is the unified BUSINESS identity. An auth user is an
 * AUTHENTICATION identity. An order is a TRANSACTION. This module keeps those
 * three separate: it only ever writes to the `crm_*` tables. No order row, no
 * profile, no auth user, no notification and no policy is ever touched here.
 *
 * Linking rules (deliberately strict):
 *  - automatic association happens ONLY on deterministic identities
 *    (exact canonical phone, exact auth user id, exact verified email);
 *  - names, addresses, devices and similar spellings are NEVER used;
 *  - when two different CRM customers match, nothing is merged: the conflict
 *    is reported for owner review.
 */

import { canonicalPhone } from "@/lib/phone";

export { canonicalPhone };

export type CrmIdentityKind = "auth_user" | "phone" | "email";

export type CrmMatchType =
  | "EXACT_AUTH_MATCH"
  | "EXACT_PHONE_MATCH"
  | "EXACT_EMAIL_MATCH"
  | "MULTIPLE_MATCH"
  | "NO_MATCH"
  | "INVALID_IDENTITY";

export interface CrmIdentityRow {
  kind: CrmIdentityKind;
  value: string;
  verifiedAt: string | null;
  source: string | null;
}

export interface CrmResolution {
  crmCustomerId: string | null;
  matchType: CrmMatchType;
  reason: string;
  identities: CrmIdentityRow[];
  /** Every distinct CRM customer the supplied identities pointed at. */
  candidateIds: string[];
}

/** Synthetic addresses created for phone-password login are not real emails. */
const SYNTHETIC_EMAIL_DOMAIN = "@phone.flamio.app";

/** Canonical email identity, or null for blank/synthetic/invalid values. */
export function canonicalEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  if (value.endsWith(SYNTHETIC_EMAIL_DOMAIN)) return null;
  return value;
}

async function db() {
  return (await import("@/lib/untyped-db.server")).untypedAdmin();
}

/** CRM customer carrying this exact identity, or null. */
export async function findByIdentity(
  kind: CrmIdentityKind,
  value: string,
): Promise<string | null> {
  const client = await db();
  const row = await client
    .from("crm_customer_identities")
    .select("crm_customer_id")
    .eq("kind", kind)
    .eq("value", value)
    .maybeSingle();
  if (row.error) throw new Error("CRM_TABLES_MISSING");
  return (row.data?.crm_customer_id as string | undefined) ?? null;
}

export async function readIdentities(crmCustomerId: string): Promise<CrmIdentityRow[]> {
  const client = await db();
  const rows = await client
    .from("crm_customer_identities")
    .select("kind, value, verified_at, source")
    .eq("crm_customer_id", crmCustomerId);
  if (rows.error) throw new Error("CRM_TABLES_MISSING");
  return (rows.data ?? []).map(
    (row: { kind: string; value: string; verified_at: string | null; source: string | null }) => ({
      kind: row.kind as CrmIdentityKind,
      value: row.value,
      verifiedAt: row.verified_at,
      source: row.source,
    }),
  );
}

/**
 * Deterministic resolution. Returns the matching CRM customer without ever
 * creating or merging anything.
 */
export async function resolveCrmCustomer(input: {
  authUserId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Only a verified email is allowed to resolve an identity on its own. */
  emailVerified?: boolean;
}): Promise<CrmResolution> {
  const phone = canonicalPhone(input.phone);
  const email = canonicalEmail(input.email);
  const authUserId = input.authUserId ?? null;

  if (!phone && !email && !authUserId) {
    return {
      crmCustomerId: null,
      matchType: "INVALID_IDENTITY",
      reason: "No usable phone, email or account identity was supplied.",
      identities: [],
      candidateIds: [],
    };
  }

  const hits: { type: CrmMatchType; id: string }[] = [];
  if (authUserId) {
    const id = await findByIdentity("auth_user", authUserId);
    if (id) hits.push({ type: "EXACT_AUTH_MATCH", id });
  }
  if (phone) {
    const id = await findByIdentity("phone", phone);
    if (id) hits.push({ type: "EXACT_PHONE_MATCH", id });
  }
  if (email && input.emailVerified) {
    const id = await findByIdentity("email", email);
    if (id) hits.push({ type: "EXACT_EMAIL_MATCH", id });
  }

  const candidateIds = [...new Set(hits.map((h) => h.id))];

  if (candidateIds.length === 0) {
    return {
      crmCustomerId: null,
      matchType: "NO_MATCH",
      reason: "No CRM customer carries any of these identities yet.",
      identities: [],
      candidateIds: [],
    };
  }

  if (candidateIds.length > 1) {
    return {
      crmCustomerId: null,
      matchType: "MULTIPLE_MATCH",
      reason:
        "These identities point at more than one customer record. Nothing was joined — an owner needs to review it.",
      identities: [],
      candidateIds,
    };
  }

  const crmCustomerId = candidateIds[0]!;
  // Strongest single signal wins for reporting purposes.
  const order: CrmMatchType[] = ["EXACT_AUTH_MATCH", "EXACT_PHONE_MATCH", "EXACT_EMAIL_MATCH"];
  const matchType = order.find((t) => hits.some((h) => h.type === t)) ?? "EXACT_PHONE_MATCH";

  return {
    crmCustomerId,
    matchType,
    reason: "Exact identity match.",
    identities: await readIdentities(crmCustomerId),
    candidateIds,
  };
}

/**
 * Adds an identity to a CRM customer. Never moves an identity that already
 * belongs to a different customer — that is a conflict, not an update.
 */
export async function attachIdentity(input: {
  crmCustomerId: string;
  kind: CrmIdentityKind;
  value: string;
  source: string;
  verified: boolean;
}): Promise<{ ok: boolean; conflictWith?: string }> {
  const owner = await findByIdentity(input.kind, input.value);
  if (owner && owner !== input.crmCustomerId) return { ok: false, conflictWith: owner };
  if (owner === input.crmCustomerId) return { ok: true };

  const client = await db();
  const { error } = await client.from("crm_customer_identities").insert({
    crm_customer_id: input.crmCustomerId,
    kind: input.kind,
    value: input.value,
    source: input.source,
    verified_at: input.verified ? new Date().toISOString() : null,
  });
  if (error) {
    // Unique(kind, value) race: re-read and treat an existing row as success.
    const again = await findByIdentity(input.kind, input.value);
    if (again === input.crmCustomerId) return { ok: true };
    if (again) return { ok: false, conflictWith: again };
    throw new Error("CRM_IDENTITY_WRITE_FAILED");
  }
  return { ok: true };
}

/**
 * Auth user id behind a customer phone number, using indexed lookups only.
 *
 * Exactly the same rule as before (an order that already carries the auth user
 * id, matched on canonical phone) — but resolved through the CRM identity index
 * first and then through an indexed, filtered order query instead of reading
 * thousands of historical orders. Nothing is written, no order row is changed.
 */
export async function resolveAuthUserIdByPhone(rawPhone: string): Promise<string | null> {
  const phone = canonicalPhone(rawPhone);
  if (!phone) return null;
  const client = await db();

  // 1. CRM identity index (unique on kind+value).
  try {
    const crmCustomerId = await findByIdentity("phone", phone);
    if (crmCustomerId) {
      const identities = await readIdentities(crmCustomerId);
      const authIdentity = identities.find((row) => row.kind === "auth_user");
      if (authIdentity) return authIdentity.value;
    }
  } catch {
    // CRM identity tables unavailable — fall through to the order lookup.
  }

  // 2. Indexed order lookup on the stored phone formats. No full-table scan.
  const local = phone.slice(3); // 01XXXXXXXXX without the country code
  const variants = [phone, `+${phone}`, `0${local}`, local, `88${local}`];
  const direct = await client
    .from("orders")
    .select("user_id")
    .in("customer_phone", variants)
    .not("user_id", "is", null)
    .limit(1);
  const directMatch = (direct.data?.[0]?.user_id as string | undefined) ?? null;
  if (directMatch) return directMatch;

  // 3. Bounded legacy fallback for oddly formatted historical phone values.
  const recent = await client
    .from("orders")
    .select("user_id, customer_phone")
    .not("user_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  const match = ((recent.data ?? []) as { user_id: string; customer_phone: string | null }[]).find(
    (row) => canonicalPhone(row.customer_phone) === phone,
  );
  return match?.user_id ?? null;
}

/** Flips a CRM customer to `account` once an auth identity is attached. */
export async function markCustomerType(
  crmCustomerId: string,
  customerType: "guest" | "account",
): Promise<void> {
  const client = await db();
  await client
    .from("crm_customers")
    .update({ customer_type: customerType, updated_at: new Date().toISOString() })
    .eq("id", crmCustomerId);
}
