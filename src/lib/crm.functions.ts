/**
 * Customer CRM (Phase 1) server functions.
 *
 * Reads existing data only (orders, profiles, order_reviews, reward
 * transactions, addresses, favourites) and stores CRM-only extras in the new
 * `crm_*` tables. Nothing here sends a message, touches notifications, or
 * links a guest to an account.
 */

import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhone } from "@/lib/phone";

export interface CrmOrderRow {
  id: string;
  code: string;
  total: number;
  status: string;
  channel: string;
  fulfillment: string;
  createdAt: string;
}

export interface CrmNote {
  id: string;
  body: string;
  createdAt: string;
}

export interface CrmIdentityView {
  kind: "auth_user" | "phone" | "email";
  label: string;
  value: string;
  verified: boolean;
  source: string | null;
}

export interface CrmCustomerDetail {
  crmId: string | null;
  name: string;
  phoneMasked: string;
  phone: string | null;
  customerType: "guest" | "account";
  accountEmail: string | null;
  accountCreatedAt: string | null;
  possibleAccountMatch: boolean;
  orderCount: number;
  guestOrderCount: number;
  accountOrderCount: number;
  totalSpent: number;
  averageOrder: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  orders: CrmOrderRow[];
  reviewCount: number;
  rewardPoints: number;
  addressCount: number;
  favoriteCount: number;
  notes: CrmNote[];
  tags: string[];
  canManage: boolean;
  storageReady: boolean;
  /** Identity foundation (Phase 2). */
  identities: CrmIdentityView[];
  accountLinked: boolean;
  identityConflict: boolean;
  /** Account that could be linked by the owner (exact phone match only). */
  linkCandidate: { authUserId: string; emailMasked: string | null } | null;
}

function mask(raw: string): string {
  const digits = normalizePhone(raw);
  if (digits.length < 6) return "•••";
  return `+${digits.slice(0, 5)}•••${digits.slice(-3)}`;
}

function maskEmail(raw: string): string {
  const [local = "", domain = ""] = raw.split("@");
  const head = local.slice(0, 2);
  return `${head}•••@${domain}`;
}

/** Owner/manager, or staff allowed to open customers. */
async function assertRead(userId: string) {
  const { assertAnyPermission } = await import("@/lib/owner.server");
  return assertAnyPermission(userId, ["customer_profiles", "customers"], "view");
}

async function assertWrite(userId: string) {
  const { assertAnyPermission } = await import("@/lib/owner.server");
  return assertAnyPermission(userId, ["customer_notes", "customers"], "manage");
}

async function canWrite(userId: string): Promise<boolean> {
  try {
    await assertWrite(userId);
    return true;
  } catch {
    return false;
  }
}

export const crmGetCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string }) => input)
  .handler(async ({ data, context }): Promise<CrmCustomerDetail> => {
    await assertRead(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const phone = normalizePhone(data.phone);

    const orderRows = await supabaseAdmin
      .from("orders")
      .select("id, code, total, status, channel, fulfillment, created_at, customer_name, customer_phone, user_id")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (orderRows.error) {
      console.error("CRM profile orders failed", orderRows.error);
      throw new Error("We couldn't load this customer. Please try again.");
    }

    const mine = (orderRows.data ?? []).filter(
      (row) => normalizePhone(row.customer_phone) === phone,
    );

    if (mine.length === 0) {
      throw new Error("This customer no longer has any orders.");
    }

    const orders: CrmOrderRow[] = mine.map((row) => ({
      id: row.id,
      code: row.code,
      total: Number(row.total),
      status: row.status,
      channel: row.channel,
      fulfillment: row.fulfillment,
      createdAt: row.created_at,
    }));

    const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);
    const lastOrderAt = orders[0]?.createdAt ?? null;
    const firstOrderAt = orders[orders.length - 1]?.createdAt ?? null;
    const accountOrder = mine.find((row) => row.user_id);
    const name = mine[0]?.customer_name ?? "Customer";

    // Account details — existing profiles table, read only.
    let accountUserId: string | null = accountOrder?.user_id ?? null;
    let accountEmail: string | null = null;
    let accountCreatedAt: string | null = null;
    let possibleAccountMatch = false;

    const profileByPhone = await supabaseAdmin
      .from("profiles")
      .select("id, email, phone, created_at")
      .limit(5000);

    if (!profileByPhone.error) {
      const match = (profileByPhone.data ?? []).find(
        (p) => p.phone && normalizePhone(p.phone) === phone,
      );
      if (match) {
        if (!accountUserId) possibleAccountMatch = true;
        accountUserId = accountUserId ?? match.id;
        accountEmail = match.email ?? null;
        accountCreatedAt = match.created_at;
      }
    }

    let reviewCount = 0;
    let rewardPoints = 0;
    let addressCount = 0;
    let favoriteCount = 0;

    if (accountOrder?.user_id) {
      const uid = accountOrder.user_id;
      const [reviews, rewards, addresses, favorites] = await Promise.all([
        supabaseAdmin.from("order_reviews").select("id").eq("user_id", uid),
        supabaseAdmin.from("reward_transactions").select("points").eq("user_id", uid),
        supabaseAdmin.from("customer_addresses").select("id").eq("user_id", uid),
        supabaseAdmin.from("favorites").select("id").eq("user_id", uid),
      ]);
      reviewCount = reviews.data?.length ?? 0;
      rewardPoints = (rewards.data ?? []).reduce((sum, r) => sum + Number(r.points), 0);
      addressCount = addresses.data?.length ?? 0;
      favoriteCount = favorites.data?.length ?? 0;
    }

    const customerType: "guest" | "account" = accountOrder?.user_id ? "account" : "guest";
    const accountOrderCount = mine.filter((row) => row.user_id).length;
    const guestOrderCount = mine.length - accountOrderCount;

    // CRM extras. When the Phase 1 tables have not been installed yet the
    // profile still works — notes and tags are simply unavailable.
    let crmId: string | null = null;
    let notes: CrmNote[] = [];
    let tags: string[] = [];
    let storageReady = true;
    let identities: CrmIdentityView[] = [];
    let identityConflict = false;
    let accountLinked = false;

    try {
      const { ensureCrmCustomer, recordCrmAccess } = await import("@/lib/crm.server");
      const record = await ensureCrmCustomer({
        phone,
        displayName: name,
        customerType,
        firstOrderAt,
        lastOrderAt,
        // Only deterministic identities are attached automatically: the order
        // itself carries the auth user id, so that link is certain.
        authUserId: accountOrder?.user_id ?? null,
        email: accountOrder?.user_id ? accountEmail : null,
        emailVerified: Boolean(accountOrder?.user_id && accountEmail),
      });
      crmId = record.id;
      identityConflict = record.conflict;
      await recordCrmAccess(record.id, context.userId, "view_profile");

      const { readIdentities } = await import("@/lib/crm-identity.server");
      const rows = await readIdentities(record.id);
      accountLinked = rows.some((row) => row.kind === "auth_user");
      identities = rows.map((row) => ({
        kind: row.kind,
        label:
          row.kind === "phone" ? "Phone" : row.kind === "email" ? "Email" : "Customer account",
        value:
          row.kind === "phone"
            ? mask(row.value)
            : row.kind === "email"
              ? maskEmail(row.value)
              : "Linked",
        verified: Boolean(row.verifiedAt),
        source: row.source,
      }));

      const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();
      const noteRows = await db
        .from("crm_customer_notes")
        .select("id, body, created_at")
        .eq("crm_customer_id", record.id)
        .order("created_at", { ascending: false });
      notes = (noteRows.data ?? []).map((row: { id: string; body: string; created_at: string }) => ({
        id: row.id,
        body: row.body,
        createdAt: row.created_at,
      }));

      const tagRows = await db
        .from("crm_customer_tag_links")
        .select("tag_id, crm_customer_tags(name)")
        .eq("crm_customer_id", record.id);
      tags = (tagRows.data ?? [])
        .map((row: { crm_customer_tags?: { name?: string } | null }) => row.crm_customer_tags?.name)
        .filter((value: string | undefined): value is string => Boolean(value));
    } catch {
      storageReady = false;
    }

    return {
      crmId,
      name,
      phoneMasked: mask(phone),
      phone: null,
      customerType,
      accountEmail,
      accountCreatedAt,
      possibleAccountMatch,
      orderCount: orders.length,
      guestOrderCount,
      accountOrderCount,
      totalSpent: Number(totalSpent.toFixed(2)),
      averageOrder: Number((totalSpent / orders.length).toFixed(2)),
      firstOrderAt,
      lastOrderAt,
      orders: orders.slice(0, 50),
      reviewCount,
      rewardPoints,
      addressCount,
      favoriteCount,
      notes,
      tags,
      canManage: await canWrite(context.userId),
      storageReady,
      identities,
      accountLinked,
      identityConflict,
      linkCandidate:
        !accountLinked && possibleAccountMatch && accountUserId
          ? { authUserId: accountUserId, emailMasked: accountEmail ? maskEmail(accountEmail) : null }
          : null,
    };
  });

/**
 * Owner-controlled SAFE LINK: attaches an existing customer account to this
 * CRM record. Allowed only when the account's own phone number is an exact
 * canonical match for this customer, so the link is deterministic. Nothing is
 * merged and no order row is ever rewritten — a guest order stays a guest
 * order.
 */
export const crmLinkAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; authUserId: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["customer_profiles", "customers"], "manage");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canonicalPhone, attachIdentity, markCustomerType, findByIdentity, canonicalEmail } =
      await import("@/lib/crm-identity.server");

    const phone = canonicalPhone(data.phone);
    if (!phone) throw new Error("This phone number can't be matched safely.");

    const profile = await supabaseAdmin
      .from("profiles")
      .select("id, phone, email")
      .eq("id", data.authUserId)
      .maybeSingle();
    if (profile.error || !profile.data) throw new Error("We couldn't find that account.");
    if (canonicalPhone(profile.data.phone) !== phone) {
      throw new Error("That account's phone number no longer matches this customer.");
    }

    const crmId = await findByIdentity("phone", phone);
    if (!crmId) throw new Error("Open this customer once more, then try again.");

    const linked = await attachIdentity({
      crmCustomerId: crmId,
      kind: "auth_user",
      value: data.authUserId,
      source: "owner_linked",
      verified: true,
    });
    if (!linked.ok) {
      throw new Error("That account already belongs to another customer record.");
    }

    const email = canonicalEmail(profile.data.email);
    if (email) {
      await attachIdentity({
        crmCustomerId: crmId,
        kind: "email",
        value: email,
        source: "owner_linked",
        verified: true,
      });
    }

    await markCustomerType(crmId, "account");
    return { ok: true };
  });

/** Reveals the full phone number and writes an audit row. */
export const crmRevealPhone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string; crmId?: string | null }) => input)
  .handler(async ({ data, context }): Promise<{ phone: string }> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["customer_profiles", "customers"], "manage");
    const phone = normalizePhone(data.phone);
    if (data.crmId) {
      try {
        const { recordCrmAccess } = await import("@/lib/crm.server");
        await recordCrmAccess(data.crmId, context.userId, "unmask_phone");
      } catch {
        // Audit table not installed yet — revealing still works.
      }
    }
    return { phone: `+${phone}` };
  });

export const crmAddNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { crmId: string; body: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertWrite(context.userId);
    const body = data.body.trim();
    if (body.length < 2) throw new Error("Please write a longer note.");

    const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();
    const { error } = await db
      .from("crm_customer_notes")
      .insert({ crm_customer_id: data.crmId, body, created_by: context.userId });
    if (error) {
      console.error("CRM note insert failed", error);
      throw new Error("We couldn't save this note. Please try again.");
    }
    return { ok: true };
  });

export const crmDeleteNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { noteId: string }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertWrite(context.userId);
    const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();
    const { error } = await db.from("crm_customer_notes").delete().eq("id", data.noteId);
    if (error) {
      console.error("CRM note delete failed", error);
      throw new Error("We couldn't remove this note. Please try again.");
    }
    return { ok: true };
  });

export const crmSetTag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { crmId: string; name: string; attach: boolean }) => input)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertWrite(context.userId);
    const name = data.name.trim().slice(0, 40);
    if (name.length < 2) throw new Error("Please use a longer tag name.");

    const db = await (await import("@/lib/untyped-db.server")).untypedAdmin();
    const existing = await db
      .from("crm_customer_tags")
      .select("id")
      .eq("name", name)
      .maybeSingle();

    let tagId = existing.data?.id as string | undefined;

    if (!data.attach) {
      if (tagId) {
        await db
          .from("crm_customer_tag_links")
          .delete()
          .eq("crm_customer_id", data.crmId)
          .eq("tag_id", tagId);
      }
      return { ok: true };
    }

    if (!tagId) {
      const created = await db.from("crm_customer_tags").insert({ name }).select("id").single();
      if (created.error || !created.data) {
        console.error("CRM tag insert failed", created.error);
        throw new Error("We couldn't save this tag. Please try again.");
      }
      tagId = created.data.id as string;
    }

    const { error } = await db
      .from("crm_customer_tag_links")
      .upsert({ crm_customer_id: data.crmId, tag_id: tagId }, { onConflict: "crm_customer_id,tag_id" });
    if (error) {
      console.error("CRM tag link failed", error);
      throw new Error("We couldn't save this tag. Please try again.");
    }
    return { ok: true };
  });
