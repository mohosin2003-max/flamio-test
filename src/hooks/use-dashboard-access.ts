import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerAccess } from "@/lib/owner.functions";

/**
 * Shared read of the caller's dashboard access (same query key as the owner
 * shell, so it is fetched once). The real boundary lives in the server
 * functions — this only decides what the UI offers.
 *
 * The server function requires a session, so the query never runs while the
 * visitor is signed out (or while the session is still being restored) and it
 * is never retried — otherwise public pages such as the cart and checkout
 * would throw "Unauthorized" for guests.
 */
export function useDashboardAccess(enabled = true) {
  const { isAuthenticated, loading, user } = useAuth();
  const fetchAccess = useServerFn(getOwnerAccess);
  const query = useQuery({
    // The key includes the signed-in user's id so a cached owner/staff role
    // can never be reused by a different user on the same device. When the
    // user changes or signs out, the key changes and the old state is left
    // behind. "owner-access" stays the prefix, so invalidations by that
    // prefix (owner shell, staff editor) keep working.
    queryKey: ["owner-access", user?.id ?? null],
    queryFn: async () => {
      // Session can end between render and fetch (e.g. during logout).
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      return fetchAccess();
    },
    enabled: enabled && isAuthenticated && !loading,
    retry: false,
    staleTime: 10 * 60 * 1000,
  });

  const data = query.data;
  return {
    ...query,
    isManager: Boolean(data?.isManager),
    isStaffOnly: Boolean(data?.isStaff && !data?.isManager),
  };
}

/**
 * Startup hint only: remembers, per user id, whether this device last saw that
 * user as owner/staff. Holds no tokens or permissions — it only picks which
 * screen to show first; the server check above still decides everything.
 */
const ACCESS_HINT_KEY = "flamio.access-hint.v1";

export function readAccessHint(userId: string | null | undefined): boolean | null {
  if (!userId || typeof window === "undefined") return null;
  try {
    const raw = JSON.parse(window.localStorage.getItem(ACCESS_HINT_KEY) ?? "null");
    return raw && raw.userId === userId && typeof raw.staff === "boolean" ? raw.staff : null;
  } catch {
    return null;
  }
}

export function writeAccessHint(userId: string, staff: boolean) {
  try {
    window.localStorage.setItem(ACCESS_HINT_KEY, JSON.stringify({ userId, staff }));
  } catch {
    /* storage unavailable — hint is optional */
  }
}
