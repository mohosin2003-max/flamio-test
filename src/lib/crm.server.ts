/**
 * Customer CRM (Phase 1) — server-only helpers.
 *
 * Phase 1 is read-only towards every existing table. CRM records live in the
 * new `crm_*` tables and are derived from the EXISTING order history and
 * profiles; no order row, profile, notification or policy is ever written or
 * changed here. Guest → account merging is intentionally NOT part of Phase 1.
 */

import { normalizePhone } from "@/lib/phone";

export type CrmCustomerType = "guest" | "account";

export interface CrmRecord {
  id: string;
  displayName: string;
  primaryPhone: string;
  customerType: CrmCustomerType;
}

export function maskPhoneNumber(raw: string): string {
  const digits = normalizePhone(raw);
  if (digits.length < 6) return "•••";
  return `+${digits.slice(0, 5)}•••${digits.slice(-3)}`;
}

/**
 * Finds (or creates) the CRM record for one customer identity.
 *
 * Deterministic and idempotent: resolution goes through the shared identity
 * layer (exact auth user id / exact canonical phone / exact verified email),
 * every identity carries a unique constraint, and nothing is ever merged when
 * two records match — the conflict is reported back instead.
 */
export async function ensureCrmCustomer(input: {
  phone: string;
  displayName: string;
  customerType: CrmCustomerType;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  authUserId?: string | null;
  email?: string | null;
  emailVerified?: boolean;
}): Promise<CrmRecord & { conflict: boolean; matchType: string }> {
  const {
    canonicalEmail,
    canonicalPhone,
    resolveCrmCustomer,
    attachIdentity,
    readIdentities,
  } = await import("@/lib/crm-identity.server");

  const phone = canonicalPhone(input.phone) ?? normalizePhone(input.phone);
  const email = canonicalEmail(input.email ?? null);
  const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();

  const resolution = await resolveCrmCustomer({
    authUserId: input.authUserId ?? null,
    phone,
    email,
    emailVerified: input.emailVerified ?? false,
  });

  if (resolution.matchType === "MULTIPLE_MATCH") {
    // Two different customer records carry these identities. Use the phone
    // record (the one this page is keyed by) and never join them.
    const phoneOwner = await (async () => {
      const row = await db
        .from("crm_customer_identities")
        .select("crm_customer_id")
        .eq("kind", "phone")
        .eq("value", phone)
        .maybeSingle();
      return (row.data?.crm_customer_id as string | undefined) ?? resolution.candidateIds[0]!;
    })();
    return {
      id: phoneOwner,
      displayName: input.displayName,
      primaryPhone: phone,
      customerType: input.customerType,
      conflict: true,
      matchType: resolution.matchType,
    };
  }

  let id = resolution.crmCustomerId;

  if (!id) {
    const created = await db
      .from("crm_customers")
      .insert({
        display_name: input.displayName,
        primary_phone: phone,
        customer_type: input.customerType,
        first_order_at: input.firstOrderAt,
        last_order_at: input.lastOrderAt,
      })
      .select("id")
      .single();

    if (created.error || !created.data) throw new Error("CRM_TABLES_MISSING");
    id = created.data.id as string;

    const identity = await db
      .from("crm_customer_identities")
      .insert({ kind: "phone", value: phone, source: "guest_order", crm_customer_id: id });
    if (identity.error) {
      // Never leave a half-created record behind.
      await db.from("crm_customers").delete().eq("id", id);
      throw new Error("CRM_TABLES_MISSING");
    }
  } else {
    // Refresh derived fields from authoritative order data. Blank values never
    // overwrite better existing data.
    const patch: Record<string, string> = { updated_at: new Date().toISOString() };
    if (input.displayName) patch["display_name"] = input.displayName;
    if (input.firstOrderAt) patch["first_order_at"] = input.firstOrderAt;
    if (input.lastOrderAt) patch["last_order_at"] = input.lastOrderAt;
    // guest → account only; an account is never downgraded to guest.
    if (input.customerType === "account") patch["customer_type"] = "account";
    await db.from("crm_customers").update(patch).eq("id", id);
  }

  let conflict = false;

  if (input.authUserId) {
    const result = await attachIdentity({
      crmCustomerId: id,
      kind: "auth_user",
      value: input.authUserId,
      source: "account_signup",
      verified: true,
    });
    if (!result.ok) conflict = true;
  }
  if (email && input.emailVerified) {
    const result = await attachIdentity({
      crmCustomerId: id,
      kind: "email",
      value: email,
      source: "account_profile",
      verified: true,
    });
    if (!result.ok) conflict = true;
  }

  // Keep the phone identity present for records created before Phase 2.
  const identities = await readIdentities(id);
  if (!identities.some((row) => row.kind === "phone" && row.value === phone)) {
    const result = await attachIdentity({
      crmCustomerId: id,
      kind: "phone",
      value: phone,
      source: "guest_order",
      verified: false,
    });
    if (!result.ok) conflict = true;
  }

  return {
    id,
    displayName: input.displayName,
    primaryPhone: phone,
    customerType: input.customerType,
    conflict,
    matchType: resolution.matchType,
  };
}

/** Records who opened or unmasked a customer record. Append-only. */
export async function recordCrmAccess(
  crmCustomerId: string,
  actorId: string,
  action: "view_profile" | "unmask_phone",
): Promise<void> {
  const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();
  await db
    .from("crm_access_audit")
    .insert({ crm_customer_id: crmCustomerId, actor_id: actorId, action });
}
