import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Home, Lock, MessageCircle, ReceiptText, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { ownerListContactThreads } from "@/lib/contact-messages.functions";
import { ownerGetDashboardSummary } from "@/lib/dashboard.functions";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/owner", label: "Home", icon: Home, kind: "home" },
  { to: "/owner/inbox", label: "Messages", icon: MessageCircle, kind: "messages" },
  { to: "/owner/orders", label: "Orders", icon: ReceiptText, kind: "orders" },
  { to: "/owner/account", label: "Account", icon: UserRound, kind: "account" },
] as const;

export function StaffBottomNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { isAuthenticated, loading } = useAuth();
  const signedIn = isAuthenticated && !loading;
  const access = useDashboardAccess(signedIn);
  const listThreads = useServerFn(ownerListContactThreads);
  const getSummary = useServerFn(ownerGetDashboardSummary);
  const canMessage = signedIn && hasPermission(access.data, "customers");
  const canOrder = signedIn && (hasPermission(access.data, "online_orders") || hasPermission(access.data, "order_management"));

  const threads = useQuery({
    queryKey: ["contact-inbox", "owner"],
    queryFn: () => listThreads(),
    enabled: canMessage,
    refetchInterval: 20_000,
    retry: false,
  });
  const summary = useQuery({
    queryKey: ["owner-dashboard-summary"],
    queryFn: () => getSummary(),
    enabled: canOrder,
    refetchInterval: 30_000,
    retry: false,
  });

  const unread = (threads.data ?? []).reduce((total, thread) => total + thread.unreadCount, 0);
  const activeOrders = summary.data?.activeOnlineOrders ?? 0;

  function isActive(kind: (typeof NAV_ITEMS)[number]["kind"]) {
    if (kind === "messages") return pathname.startsWith("/owner/inbox");
    if (kind === "orders") return pathname.startsWith("/owner/orders");
    if (kind === "account") {
      return ["/owner/account", "/owner/my-account", "/owner/staff", "/owner/staff-accounts", "/owner/settings"].some((path) => pathname.startsWith(path));
    }
    return !pathname.startsWith("/owner/inbox") && !pathname.startsWith("/owner/orders") && !["/owner/account", "/owner/my-account", "/owner/staff", "/owner/staff-accounts", "/owner/settings"].some((path) => pathname.startsWith(path));
  }

  return (
    <nav aria-label="Staff workspace" className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const allowed = item.kind === "messages" ? canMessage : item.kind === "orders" ? canOrder : true;
          const count = item.kind === "messages" ? unread : item.kind === "orders" ? activeOrders : 0;
          const content = (
            <>
              <span className="relative">
                <item.icon aria-hidden="true" className="size-5" />
                {count > 0 ? <Badge className="absolute -right-3 -top-2 min-w-5 justify-center border-2 border-background px-1 text-[10px] leading-4">{count > 99 ? "99+" : count}</Badge> : null}
                {!allowed ? <Lock aria-hidden="true" className="absolute -right-2 -top-1 size-3 text-muted-foreground" /> : null}
              </span>
              <span>{item.label}</span>
            </>
          );
          return (
            <li key={item.kind}>
              {allowed ? (
                <Link to={item.to} className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors", isActive(item.kind) && "text-primary")}>
                  {content}
                </Link>
              ) : (
                <div aria-disabled="true" className="flex min-h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground/60">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function StaffBottomNavSpacer() {
  return <div aria-hidden="true" className="h-20" />;
}