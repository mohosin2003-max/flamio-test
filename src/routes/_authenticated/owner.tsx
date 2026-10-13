import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Eye, Loader2, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/branding/BrandLogo";
import { NewOrderAlarm } from "@/components/owner/NewOrderAlarm";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { claimOwnership } from "@/lib/owner.functions";
import { canManage, hasPermission } from "@/lib/permissions";
import type { StaffPermission } from "@/lib/permissions";

/**
 * Owner area shell. The real access boundary lives in the server functions
 * (every owner endpoint re-checks the caller's role); this gate is UX only.
 */
export const Route = createFileRoute("/_authenticated/owner")({
  head: () => ({
    meta: [
      { title: "Owner Dashboard — Flamio" },
      { name: "description", content: "Manage Flamio orders, menu and restaurant settings." },
      { property: "og:title", content: "Owner Dashboard — Flamio" },
      { property: "og:description", content: "Manage Flamio orders, menu and restaurant settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerLayout,
});

/** `permission: null` means everyone with dashboard access sees the tab. */
const TABS: {
  to: string;
  label: string;
  exact: boolean;
  permission: StaffPermission | StaffPermission[] | null;
  /** Strictly the owner role — managers and staff never see these. */
  ownerRoleOnly?: boolean;
}[] = [
  { to: "/owner", label: "Home", exact: true, permission: null },
  { to: "/owner/account", label: "Account", exact: false, permission: null },
  { to: "/owner/orders", label: "Orders", exact: false, permission: ["online_orders", "order_management"] },
  { to: "/owner/pos", label: "Counter sale", exact: false, permission: "pos" },
  { to: "/owner/platforms", label: "Platforms", exact: false, permission: "platform_sales" },
  { to: "/owner/platform-sale", label: "Platform sale", exact: false, permission: "platform_sales" },
  { to: "/owner/menu", label: "Menu", exact: false, permission: "menu" },
  { to: "/owner/combos", label: "Combos", exact: false, permission: "combos" },
  { to: "/owner/inventory", label: "Inventory", exact: false, permission: "inventory" },
  { to: "/owner/purchases", label: "Purchases", exact: false, permission: "purchases" },
  { to: "/owner/suppliers", label: "Suppliers", exact: false, permission: "suppliers" },
  { to: "/owner/delivery", label: "Delivery", exact: false, permission: "delivery" },
  { to: "/owner/riders", label: "Riders", exact: false, permission: "riders" },
  { to: "/owner/coupons", label: "Coupons", exact: false, permission: "coupons" },
  { to: "/owner/rewards", label: "Rewards", exact: false, permission: "rewards" },
  { to: "/owner/challenges", label: "Challenges", exact: false, permission: "challenges" },
  { to: "/owner/banners", label: "Banners", exact: false, permission: "banners" },
  { to: "/owner/reports", label: "Reports", exact: false, permission: "reports" },
  { to: "/owner/customers", label: "Customers", exact: false, permission: "customers" },
  {
    to: "/owner/customers/$customerId",
    label: "Customer",
    exact: false,
    permission: ["customer_profiles", "customers"],
  },
  { to: "/owner/inbox", label: "Inbox", exact: false, permission: "customers" },
  { to: "/owner/reviews", label: "Reviews", exact: false, permission: "reviews" },
  { to: "/owner/recovery", label: "Account recovery", exact: false, permission: "account_recovery" },

  { to: "/owner/staff", label: "Staff", exact: false, permission: "staff" },
  {
    to: "/owner/staff-accounts",
    label: "Staff accounts",
    exact: false,
    permission: "staff_finance",
  },
  {
    to: "/owner/my-account",
    label: "My account",
    exact: false,
    permission: ["own_salary", "own_money_taken", "own_profit_share"],
  },
  { to: "/owner/finance", label: "Owner finance", exact: false, permission: "staff_finance" },
  { to: "/owner/settings", label: "Settings", exact: false, permission: "settings" },
  {
    to: "/owner/data-storage",
    label: "Data & storage",
    exact: false,
    permission: "settings",
    ownerRoleOnly: true,
  },

];

/** Owners/managers pass; staff need at least one of the tab's permissions. */
function allows(
  access: { isManager?: boolean; permissions?: string[]; grants?: Record<string, string> | null } | null | undefined,
  permission: StaffPermission | StaffPermission[] | null,
): boolean {
  if (permission === null) return true;
  const list = Array.isArray(permission) ? permission : [permission];
  return list.some((p) => hasPermission(access, p));
}

function OwnerLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const claim = useServerFn(claimOwnership);
  const queryClient = useQueryClient();
  const [claiming, setClaiming] = useState(false);

  const access = useDashboardAccess();

  if (access.isPending && !access.error) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (access.error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <EmptyState
          title="Couldn't check your access"
          description="Something went wrong while verifying your owner access."
          action={<Button onClick={() => void access.refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  if (!access.data?.isOwner) {
    const canClaim = Boolean(access.data?.canClaim);
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            {canClaim ? (
              <ShieldCheck className="h-6 w-6 text-primary" />
            ) : (
              <Lock className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <h3 className="mt-4 font-display text-lg font-bold">
            {canClaim ? "Set up your owner access" : "Owner access required"}
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {canClaim
              ? "No owner has been set up for Flamio yet. Claim owner access with this account to manage orders, the menu and restaurant settings."
              : "This account doesn't have owner permissions yet. Ask the restaurant owner to grant you access, then refresh this page."}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {canClaim ? (
              <Button
                disabled={claiming}
                onClick={async () => {
                  setClaiming(true);
                  try {
                    await claim({});
                    await queryClient.invalidateQueries({ queryKey: ["owner-access"] });
                    toast.success("Owner access enabled");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Couldn't enable owner access",
                    );
                  } finally {
                    setClaiming(false);
                  }
                }}
              >
                {claiming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Claim owner access
              </Button>
            ) : (
              <Button variant="outline" onClick={() => void access.refetch()}>
                Check again
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link to="/">Back to Flamio</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }


  // Direct-URL protection for the UI. Every server function re-checks the
  // caller, so this only replaces a section the person may not open.
  const match = TABS.filter((tab) => tab.to !== "/owner")
    .filter((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const ownerRole = Boolean(access.data.roles?.includes("owner"));
  const sectionAllowed =
    !match || (allows(access.data, match.permission) && (!match.ownerRoleOnly || ownerRole));
  const sectionKeys = match
    ? Array.isArray(match.permission)
      ? match.permission
      : match.permission
        ? [match.permission]
        : []
    : [];
  const viewOnlySection =
    sectionAllowed &&
    sectionKeys.length > 0 &&
    !access.data.isManager &&
    !sectionKeys.some((key) => canManage(access.data, key));


  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6 sm:py-7">
      <header className="mb-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <BrandLogo showName textClassName="text-lg tracking-tight" />
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> {access.data.isManager ? "Owner" : "Staff"}
          </p>
        </div>
        <h1 className="font-display text-2xl font-bold">{pathname.startsWith("/owner/inbox") ? "Messages" : pathname.startsWith("/owner/orders") ? "Orders" : pathname.startsWith("/owner/account") ? "Account" : "Workspace"}</h1>
      </header>

      {allows(access.data, ["online_orders", "order_management"]) ? <NewOrderAlarm /> : null}

      {viewOnlySection ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            You have view-only access to this section. You can read everything here, but changes
            aren't allowed.
          </span>
        </div>
      ) : null}

      {sectionAllowed ? (
        <Outlet />
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="mt-4 font-display text-lg font-bold">Access restricted</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            You don't have permission for this section. Ask the owner to switch it on for you.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline">
              <Link to="/owner">Back to dashboard</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
