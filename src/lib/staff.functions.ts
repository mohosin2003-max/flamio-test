import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ACCESS_LEVELS, STAFF_PERMISSIONS, isAccessLevel, isStaffPermission } from "@/lib/permissions";
import type { PermissionGrants, StaffAccessLevel, StaffPermission } from "@/lib/permissions";
import { isValidPhone, normalizePhone, phoneToAuthEmail } from "@/lib/phone";

/**
 * Staff / role management for the owner area.
 *
 * Reuses the EXISTING tables only:
 *  - `public.user_roles`   (owner / admin / staff — the real permission source)
 *  - `public.owner_invites` (already existed, previously unused: pending invites by phone)
 *  - `public.profiles`     (display info: name, phone, email)
 *
 * No new storage is introduced. New credentials are sent directly to the
 * authentication provider and are never stored in application tables.
 */

export type StaffRole = "owner" | "admin" | "staff";

export type StaffMember = {
  userId: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  roles: StaffRole[];
  /** Sections this person can open. Owners/managers always have all of them. */
  permissions: StaffPermission[];
  /** Access level per granted section. */
  grants: PermissionGrants;
  joinedAt: string | null;
};

export type StaffInvite = {
  id: string;
  phone: string;
  note: string | null;
  createdAt: string;
  /** Set when somebody has since signed up with this phone number. */
  matchedUserId: string | null;
  matchedName: string | null;
};

const rolesEnum = z.enum(["owner", "admin", "staff"]);

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const isEmail = (value: string) => /^\S+@\S+\.\S+$/.test(value.trim());

function inviteIdentity(value: string): string {
  return isEmail(value) ? normalizeEmail(value) : normalizePhone(value);
}

export const ownerListStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ members: StaffMember[]; invites: StaffInvite[]; me: string }> => {
      const { assertPermission } = await import("@/lib/owner.server");
      await assertPermission(context.userId, "staff", "view");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [{ data: roleRows }, { data: inviteRows }] = await Promise.all([
        supabaseAdmin
          .from("user_roles")
          .select("user_id, role, created_at")
          .order("created_at"),
        supabaseAdmin
          .from("owner_invites")
          .select("id, phone, note, created_at")
          .order("created_at", { ascending: false }),
      ]);

      const userIds = Array.from(new Set((roleRows ?? []).map((r) => r.user_id)));
      const invitePhones = (inviteRows ?? [])
        .map((i) => i.phone)
        .filter((value) => !isEmail(value))
        .map(normalizePhone);
      const inviteEmails = (inviteRows ?? [])
        .map((i) => i.phone)
        .filter(isEmail)
        .map(normalizeEmail);

      const [{ data: staffProfiles }, { data: invitedProfiles }] = await Promise.all([
        userIds.length
          ? supabaseAdmin.from("profiles").select("id, full_name, phone, email").in("id", userIds)
          : Promise.resolve({ data: [] as never[] }),
        invitePhones.length || inviteEmails.length
          ? supabaseAdmin.from("profiles").select("id, full_name, phone, email")
          : Promise.resolve({ data: [] as never[] }),
      ]);

      const profileById = new Map(
        (staffProfiles ?? []).map((p) => [
          p.id as string,
          p as { id: string; full_name: string | null; phone: string | null; email: string | null },
        ]),
      );

      const profileByIdentity = new Map<string, { id: string; full_name: string | null }>();
      for (const row of invitedProfiles ?? []) {
        const profile = row as {
          id: string;
          full_name: string | null;
          phone: string | null;
          email: string | null;
        };
        if (profile.phone) profileByIdentity.set(normalizePhone(profile.phone), profile);
        if (profile.email) profileByIdentity.set(normalizeEmail(profile.email), profile);
      }

      const byUser = new Map<string, StaffMember>();
      for (const row of roleRows ?? []) {
        const existing = byUser.get(row.user_id);
        if (existing) {
          existing.roles.push(row.role as StaffRole);
          continue;
        }
        const profile = profileById.get(row.user_id);
        byUser.set(row.user_id, {
          userId: row.user_id,
          fullName: profile?.full_name ?? null,
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
          roles: [row.role as StaffRole],
          permissions: [],
          grants: {},
          joinedAt: row.created_at,
        });
      }

      // Effective access: managers are unrestricted, staff get their own rows.
      let permRows: { user_id: string; permission: string; access_level?: string | null }[] = [];
      if (userIds.length) {
        const { untypedAdmin } = await import("@/lib/untyped-db.server");
        const withLevel = await (await untypedAdmin())
          .from("staff_permissions")
          .select("user_id, permission, access_level")
          .in("user_id", userIds);
        if (withLevel.error) {
          const plain = await supabaseAdmin
            .from("staff_permissions")
            .select("user_id, permission")
            .in("user_id", userIds);
          permRows = (plain.data ?? []) as typeof permRows;
        } else {
          permRows = (withLevel.data ?? []) as unknown as typeof permRows;
        }
      }

      for (const member of byUser.values()) {
        const isOwner = member.roles.includes("owner");
        if (isOwner) {
          member.permissions = [...STAFF_PERMISSIONS];
          member.grants = Object.fromEntries(
            STAFF_PERMISSIONS.map((p) => [p, "manage" as StaffAccessLevel]),
          );
          continue;
        }
        const grants: PermissionGrants = {};
        for (const row of permRows) {
          if (row.user_id !== member.userId) continue;
          if (!isStaffPermission(row.permission)) continue;
          grants[row.permission] =
            row.access_level && isAccessLevel(row.access_level) ? row.access_level : "manage";
        }
        member.grants = grants;
        if (member.roles.includes("admin") && Object.keys(grants).length === 0) {
          member.permissions = [...STAFF_PERMISSIONS];
          member.grants = Object.fromEntries(
            STAFF_PERMISSIONS.map((permission) => [permission, "manage" as StaffAccessLevel]),
          );
        } else {
          member.permissions = Object.keys(grants) as StaffPermission[];
        }
      }


      const invites: StaffInvite[] = (inviteRows ?? []).map((invite) => {
        const match = profileByIdentity.get(inviteIdentity(invite.phone)) ?? null;
        const alreadyStaff = match ? byUser.has(match.id) : false;
        return {
          id: invite.id,
          phone: invite.phone,
          note: invite.note,
          createdAt: invite.created_at,
          matchedUserId: match && !alreadyStaff ? match.id : null,
          matchedName: match && !alreadyStaff ? match.full_name : null,
        };
      });

      return { members: Array.from(byUser.values()), invites, me: context.userId };
    },
  );

/** Records a pending invite by phone or email (legacy compatibility). */
export const ownerCreateInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().trim().min(6).max(24),
        note: z.string().trim().max(200).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("owner_invites")
      .insert({ phone: inviteIdentity(data.phone), note: data.note });

    if (error) {
      console.error("Create invite failed", error);
      throw new Error("We couldn't save this invite. Please try again.");
    }
    return { ok: true };
  });

export const ownerDeleteInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "staff");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin.from("owner_invites").delete().eq("id", data.id);
    if (error) {
      console.error("Delete invite failed", error);
      throw new Error("We couldn't remove this invite. Please try again.");
    }
    return { ok: true };
  });

/** Grants (or changes) a role for an existing account. */
export const ownerSetStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ userId: z.string().uuid(), role: rolesEnum }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only a full owner may create or change another owner.
    const { data: callerIsOwner } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "owner",
    });
    if (data.role === "owner" && !callerIsOwner) {
      throw new Error("Only an owner can give owner access.");
    }

    const { data: current } = await supabaseAdmin
      .from("user_roles")
      .select("id, role")
      .eq("user_id", data.userId);

    const targetIsOwner = (current ?? []).some((r) => r.role === "owner");
    if (targetIsOwner && data.role !== "owner" && !callerIsOwner) {
      throw new Error("Only an owner can change owner access.");
    }

    // Replace the person's roles with the single selected role.
    const stale = (current ?? []).filter((r) => r.role !== data.role).map((r) => r.id);
    if (stale.length) {
      if (targetIsOwner) {
        const { count } = await supabaseAdmin
          .from("user_roles")
          .select("id", { count: "exact", head: true })
          .eq("role", "owner");
        if ((count ?? 0) <= 1 && data.role !== "owner") {
          // Expected validation, not a crash: return it so the UI can show a message.
          return {
            ok: false as const,
            message: "This is the only owner — give someone else owner access first.",
          };
        }

      }
      const { error: delError } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .in("id", stale);
      if (delError) {
        console.error("Role cleanup failed", delError);
        throw new Error("We couldn't update this person's access. Please try again.");
      }
    }

    if (!(current ?? []).some((r) => r.role === data.role)) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role });
      if (error && error.code !== "23505") {
        console.error("Grant role failed", error);
        throw new Error("We couldn't update this person's access. Please try again.");
      }
    }

    return { ok: true as const, message: null };

  });

/** Turns dashboard access off by removing the person's role rows. */
export const ownerRevokeStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.userId === context.userId) {
      throw new Error("You can't remove your own access.");
    }

    const { data: current } = await supabaseAdmin
      .from("user_roles")
      .select("id, role")
      .eq("user_id", data.userId);

    if ((current ?? []).some((r) => r.role === "owner")) {
      const { data: callerIsOwner } = await supabaseAdmin.rpc("has_role", {
        _user_id: context.userId,
        _role: "owner",
      });
      if (!callerIsOwner) throw new Error("Only an owner can remove owner access.");

      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner");
      if ((count ?? 0) <= 1) {
        throw new Error("This is the only owner — give someone else owner access first.");
      }
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId);

    if (error) {
      console.error("Revoke access failed", error);
      throw new Error("We couldn't remove this person's access. Please try again.");
    }
    return { ok: true };
  });

/** Finds an existing account by phone or email so a role can be granted to it. */
export const ownerFindAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().trim().min(3).max(120) }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{ userId: string; fullName: string | null; phone: string | null } | null> => {
      const { assertPermission } = await import("@/lib/owner.server");
      await assertPermission(context.userId, "staff");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const value = isEmail(data.query) ? normalizeEmail(data.query) : normalizePhone(data.query);
      const { data: rows } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .or(isEmail(data.query) ? `email.eq.${value}` : `phone.eq.${value}`)
        .limit(1);

      const match = (rows ?? [])[0];
      if (!match) return null;
      return { userId: match.id, fullName: match.full_name, phone: match.phone };
    },
  );

const grantSchema = z.object({
  permission: z.enum(STAFF_PERMISSIONS),
  level: z.enum(ACCESS_LEVELS),
});

/** Creates or links one real auth account, then applies existing role/permission rows. */
export const ownerCreateStaffAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        fullName: z.string().trim().min(2).max(120),
        phone: z.string().trim().min(6).max(24),
        email: z.string().trim().max(160).nullable(),
        password: z.string().min(8).max(200),
        role: rolesEnum,
        grants: z.array(grantSchema).max(STAFF_PERMISSIONS.length),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    if (!isValidPhone(data.phone)) throw new Error("Enter a valid phone number.");
    const phone = normalizePhone(data.phone);
    const email = data.email ? normalizeEmail(data.email) : null;
    if (email && !isEmail(email)) throw new Error("Enter a valid email address.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.role === "owner") {
      const { data: callerIsOwner } = await supabaseAdmin.rpc("has_role", {
        _user_id: context.userId,
        _role: "owner",
      });
      if (!callerIsOwner) throw new Error("Only an owner can create another owner.");
    }
    const { data: matches } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .or(email ? `phone.eq.${phone},email.eq.${email}` : `phone.eq.${phone}`)
      .limit(2);

    let userId: string | null = null;
    for (const match of matches ?? []) {
      const { data: existing } = await supabaseAdmin.auth.admin.getUserById(match.id);
      const existingPhone = existing.user?.phone;
      const existingEmail = existing.user?.email?.toLowerCase() ?? null;
      const syntheticPhone = existingEmail?.match(/^p(\d+)@phone\.flamio\.app$/)?.[1] ?? null;
      const phoneMatches =
        (existingPhone && isValidPhone(existingPhone) && normalizePhone(existingPhone) === phone) ||
        syntheticPhone === phone;
      const emailMatches = Boolean(email && existingEmail === email);
      if (phoneMatches || emailMatches) {
        userId = match.id;
        break;
      }
    }
    let created = false;
    if (!userId) {
      const authEmail = email ?? phoneToAuthEmail(phone);
      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        phone: `+${phone}`,
        password: data.password,
        email_confirm: true,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName, phone, contact_email: email ?? "" },
      });
      if (createError || !createdUser.user) {
        if (/already|registered|exists/i.test(createError?.message ?? "")) {
          throw new Error("An account already uses that email or phone. Add its existing login instead.");
        }
        console.error("Create staff auth user failed", createError);
        throw new Error("We couldn't create this staff account. Please try again.");
      }
      userId = createdUser.user.id;
      created = true;
    }

    const failAndRollback = async (message: string, detail: unknown) => {
      console.error(message, detail);
      if (created && userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error("We couldn't finish creating this staff account. Please try again.");
    };

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
      id: userId,
      full_name: data.fullName,
      phone,
      email,
    });
    if (profileError) await failAndRollback("Create staff profile failed", profileError);

    const { error: roleDeleteError } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", userId);
    if (roleDeleteError) await failAndRollback("Replace staff role failed", roleDeleteError);
    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: data.role });
    if (roleError) await failAndRollback("Create staff role failed", roleError);

    const { error: clearError } = await supabaseAdmin
      .from("staff_permissions")
      .delete()
      .eq("user_id", userId);
    if (clearError) await failAndRollback("Clear staff permissions failed", clearError);
    if (data.grants.length) {
      const { untypedAdmin } = await import("@/lib/untyped-db.server");
      const { error: grantsError } = await (await untypedAdmin()).from("staff_permissions").insert(
        data.grants.map((grant) => ({
          user_id: userId,
          permission: grant.permission,
          access_level: grant.level,
        })),
      );
      if (grantsError) await failAndRollback("Create staff permissions failed", grantsError);
    }

    await supabaseAdmin
      .from("owner_invites")
      .delete()
      .in("phone", [phone, data.phone.trim(), ...(email ? [email] : [])]);

    return { ok: true, existingAccount: !created };
  });

/** Claims a legacy invite using only identities attached to the authenticated user. */
export const claimMyStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: authResult, error: authError } = await context.supabase.auth.getUser();
    if (authError || !authResult.user) throw new Error("We couldn't verify your account.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("phone, email, full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const metadata = authResult.user.user_metadata ?? {};
    const authEmail = authResult.user.email?.toLowerCase() ?? null;
    const syntheticMatch = authEmail?.match(/^p(\d+)@phone\.flamio\.app$/);
    const phones = new Set<string>();
    const emails = new Set<string>();
    const addPhone = (value: unknown) => {
      if (typeof value === "string" && isValidPhone(value)) phones.add(normalizePhone(value));
    };
    const addEmail = (value: unknown) => {
      if (typeof value === "string" && isEmail(value)) emails.add(normalizeEmail(value));
    };
    addPhone(authResult.user.phone);
    // Only provider-backed identities can claim an invitation. Profile and
    // metadata values are retained for display, but are not proof of identity.
    if (syntheticMatch?.[1]) addPhone(syntheticMatch[1]);
    if (authEmail && !syntheticMatch) addEmail(authEmail);

    const profilePhone =
      profile?.phone ??
      (typeof metadata["phone"] === "string" && isValidPhone(metadata["phone"])
        ? normalizePhone(metadata["phone"])
        : null);
    const profileEmail =
      profile?.email ??
      (typeof metadata["contact_email"] === "string" && isEmail(metadata["contact_email"])
        ? normalizeEmail(metadata["contact_email"])
        : null);

    await supabaseAdmin.from("profiles").upsert({
      id: context.userId,
      full_name:
        profile?.full_name ??
        (typeof metadata["full_name"] === "string" ? metadata["full_name"] : null),
      phone: profilePhone ?? [...phones][0] ?? null,
      email: profileEmail ?? [...emails][0] ?? null,
    });

    const { data: invites } = await supabaseAdmin
      .from("owner_invites")
      .select("id, phone")
      .order("created_at", { ascending: true });
    const matching = (invites ?? []).filter((invite) => {
      const value = invite.phone;
      return isEmail(value) ? emails.has(normalizeEmail(value)) : phones.has(normalizePhone(value));
    });
    if (!matching.length) return { claimed: false };

    const { error: roleError } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: context.userId, role: "staff" }, { onConflict: "user_id,role" });
    if (roleError && roleError.code !== "23505") {
      console.error("Claim staff role failed", roleError);
      throw new Error("We couldn't activate your staff access.");
    }
    await supabaseAdmin
      .from("owner_invites")
      .delete()
      .in("id", matching.map((invite) => invite.id));
    return { claimed: true };
  });

/**
 * Replaces the sections a `staff` member can open. Owners and managers are
 * unrestricted, so their permission rows are not used.
 */
export const ownerSetStaffPermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(STAFF_PERMISSIONS.length).optional(),
        grants: z
          .array(
            z.object({
              permission: z.enum(STAFF_PERMISSIONS),
              level: z.enum(ACCESS_LEVELS),
            }),
          )
          .max(STAFF_PERMISSIONS.length)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertOwner } = await import("@/lib/owner.server");
    await assertOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Accepts either the newer {permission, level} list or the older flat list
    // (which keeps its existing meaning: full access).
    const wanted = new Map<StaffPermission, StaffAccessLevel>();
    for (const permission of data.permissions ?? []) wanted.set(permission, "manage");
    for (const grant of data.grants ?? []) wanted.set(grant.permission, grant.level);

    const { error: delError } = await supabaseAdmin
      .from("staff_permissions")
      .delete()
      .eq("user_id", data.userId);
    if (delError) {
      console.error("Permission cleanup failed", delError);
      throw new Error("We couldn't update this person's access. Please try again.");
    }

    if (wanted.size) {
      const rows = [...wanted.entries()].map(([permission, level]) => ({
        user_id: data.userId,
        permission,
        access_level: level,
      }));
      const { untypedAdmin } = await import("@/lib/untyped-db.server");
      const { error } = await (await untypedAdmin()).from("staff_permissions").insert(rows);
      if (error) {
        // Database without the access_level column yet: keep existing behaviour.
        const { error: plainError } = await supabaseAdmin
          .from("staff_permissions")
          .insert(rows.map(({ user_id, permission }) => ({ user_id, permission })));
        if (plainError) {
          console.error("Grant permissions failed", error, plainError);
          throw new Error("We couldn't update this person's access. Please try again.");
        }
      }
    }

    return { ok: true };
  });
