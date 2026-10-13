/**
 * Server-only owner authorization. Roles live in `public.user_roles` and are
 * checked with the SECURITY DEFINER `has_role` function, which is executable
 * by the service role only — never by the browser.
 *
 * Granular staff access reuses the same roles table plus
 * `public.staff_permissions`: owners and managers (admins) stay unrestricted,
 * while a `staff` member only gets the sections switched on for them.
 */

import { STAFF_PERMISSIONS, isAccessLevel, isStaffPermission, permissionLevel } from "@/lib/permissions";
import type { PermissionGrants, StaffAccessLevel, StaffPermission } from "@/lib/permissions";

export type OwnerContext = { userId: string };

export type AccessProfile = {
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  /** Sections this person can open (view or manage). */
  permissions: StaffPermission[];
  /** Level per section. Managers get "manage" everywhere. */
  grants: PermissionGrants;
};

const MANAGER_GRANTS = (): PermissionGrants =>
  Object.fromEntries(STAFF_PERMISSIONS.map((p) => [p, "manage" as StaffAccessLevel]));

/** Roles + effective permissions for a user. Owner/manager => everything. */
export async function getAccessProfile(userId: string): Promise<AccessProfile> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: roleRows, error: roleError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (roleError) {
    console.error("Role check failed", roleError);
    throw new Error("We couldn't verify your access. Please try again.");
  }

  const roles = (roleRows ?? []).map((r) => r.role as string);
  const isOwner = roles.includes("owner");
  const isAdmin = roles.includes("admin");
  const isStaff = roles.includes("staff");

  if (isOwner) {
    return {
      isOwner,
      isManager: true,
      isStaff,
      permissions: [...STAFF_PERMISSIONS],
      grants: MANAGER_GRANTS(),
    };
  }

  const grants = await readStaffGrants(userId);

  // Existing managers with no explicit rows retain their historic full-access
  // behaviour. Once the Owner saves section levels, those become authoritative.
  if (isAdmin && Object.keys(grants).length === 0) {
    return {
      isOwner: false,
      isManager: true,
      isStaff: true,
      permissions: [...STAFF_PERMISSIONS],
      grants: MANAGER_GRANTS(),
    };
  }

  if (!isStaff && !isAdmin) {
    return { isOwner: false, isManager: false, isStaff: false, permissions: [], grants: {} };
  }

  return {
    isOwner: false,
    isManager: false,
    isStaff: true,
    permissions: Object.keys(grants) as StaffPermission[],
    grants,
  };
}

/**
 * Reads a staff member's granted sections and their level. `access_level` is an
 * added column; if the database hasn't got it yet every existing grant keeps
 * behaving as full access.
 */
export async function readStaffGrants(userId: string): Promise<PermissionGrants> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  let rows: { permission: string; access_level?: string | null }[] = [];
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  const withLevel = await (await untypedAdmin())
    .from("staff_permissions")
    .select("permission, access_level")
    .eq("user_id", userId);

  if (withLevel.error) {
    const fallback = await supabaseAdmin
      .from("staff_permissions")
      .select("permission")
      .eq("user_id", userId);
    rows = (fallback.data ?? []) as { permission: string }[];
  } else {
    rows = (withLevel.data ?? []) as unknown as {
      permission: string;
      access_level?: string | null;
    }[];
  }

  const grants: PermissionGrants = {};
  for (const row of rows) {
    if (!isStaffPermission(row.permission)) continue;
    const level = row.access_level && isAccessLevel(row.access_level) ? row.access_level : "manage";
    grants[row.permission] = level;
  }
  return grants;
}

/** Owner or manager only (unchanged behaviour for owner-level endpoints). */
export async function assertOwner(userId: string): Promise<void> {
  const access = await getAccessProfile(userId);
  if (!access.isManager) throw new Error("Forbidden");
}

/**
 * Owner/manager, or a staff member with this permission at the required level.
 * Defaults to "manage" so an unmarked action fails closed for view-only staff.
 */
export async function assertPermission(
  userId: string,
  permission: StaffPermission,
  level: StaffAccessLevel = "manage",
): Promise<AccessProfile> {
  return assertAnyPermission(userId, [permission], level);
}

/** Owner/manager, or a staff member holding at least one of these at `level`. */
export async function assertAnyPermission(
  userId: string,
  permissions: StaffPermission[],
  level: StaffAccessLevel = "manage",
): Promise<AccessProfile> {
  const access = await getAccessProfile(userId);
  if (access.isManager) return access;
  if (access.isStaff && permissions.some((p) => satisfies(access, p, level))) return access;
  throw new Error("Forbidden");
}

function satisfies(
  access: AccessProfile,
  permission: StaffPermission,
  level: StaffAccessLevel,
): boolean {
  const current = permissionLevel(
    { isManager: access.isManager, grants: access.grants as Record<string, string> },
    permission,
  );
  if (!current) return false;
  return level === "view" ? true : current === "manage";
}

