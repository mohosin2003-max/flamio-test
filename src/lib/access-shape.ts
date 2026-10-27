/**
 * Browser-facing access shape returned by getOwnerAccess. Pure so tests can
 * assert the exact serialized response. `hasWorkspaceAccess` = may open the
 * staff workspace (same rule the dashboard gate always used); `isOwner` is the
 * real Owner role only.
 */
export interface AccessProfileLike {
  isOwner: boolean;
  isManager: boolean;
  isStaff: boolean;
  permissions: readonly string[];
  grants: Record<string, string>;
}

export function serializeOwnerAccess(access: AccessProfileLike, roles: string[], ownerCount: number) {
  const hasWorkspaceAccess = access.isOwner || access.isManager || access.isStaff || access.permissions.length > 0;
  return {
    hasWorkspaceAccess,
    isOwner: access.isOwner,
    isManager: access.isManager,
    isStaff: access.isStaff,
    permissions: [...access.permissions] as string[],
    grants: access.grants,
    roles,
    canClaim: !hasWorkspaceAccess && ownerCount === 0,
  };
}
