/**
 * Server-only kitchen authorization. Reuses the existing `public.user_roles`
 * table plus the shared permission helper — no second auth system. Owners and
 * managers keep full access; a `staff` member needs the `kitchen` permission.
 */

export async function assertKitchen(userId: string, level: "view" | "manage" = "manage"): Promise<void> {
  const { assertPermission } = await import("@/lib/owner.server");
  await assertPermission(userId, "kitchen", level);
}
