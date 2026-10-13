import { useState } from "react";
import { Link, Navigate, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  MapPin,
  MessageCircle,
} from "lucide-react";

import { orderDateParts } from "@/components/order/StaffOrderDetails";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/format";
import { isOnlineChannel } from "@/lib/order-flow";
import { statusLabel } from "@/lib/order-status";
import { formatScheduled } from "@/lib/opening-hours";
import { ownerListOrders } from "@/lib/owner.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/owner/orders/")({
  head: () => ({
    meta: [
      { title: "Orders — Flamio Owner Dashboard" },
      { name: "description", content: "Review and process Flamio restaurant orders." },
      { property: "og:title", content: "Orders — Flamio Owner Dashboard" },
      { property: "og:description", content: "Review and process Flamio restaurant orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerOrders,
});

function OwnerOrders() {
  const { order: legacyOrderId, date, activeOnline } = Route.useSearch();
  const listOrders = useServerFn(ownerListOrders);
  const [upcomingOnly, setUpcomingOnly] = useState(false);

  const orders = useQuery({
    queryKey: ["owner-orders"],
    queryFn: () => listOrders(),
    refetchInterval: 20_000,
  });

  if (legacyOrderId) {
    return <Navigate to="/owner/orders/$orderId" params={{ orderId: legacyOrderId }} search={{ message: true }} replace />;
  }

  if (orders.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (orders.error) {
    return (
      <EmptyState
        title="Couldn't load orders"
        description="Please try again."
        action={<Button onClick={() => void orders.refetch()}>Retry</Button>}
      />
    );
  }

  if (!orders.data?.length) {
    return <EmptyState title="No orders yet" description="New orders will appear here." />;
  }

  const shownOrders = orders.data.filter((order) => {
    if (
      date &&
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Dhaka",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(order.createdAt)) !== date
    ) return false;
    if (
      activeOnline &&
      (!isOnlineChannel(order.channel) || order.status === "completed" || order.status === "cancelled")
    ) return false;
    if (upcomingOnly && order.status !== "scheduled") return false;
    return true;
  });
  const upcomingCount = orders.data.filter((o) => o.status === "scheduled").length;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button type="button" size="sm" variant={upcomingOnly ? "outline" : "default"} onClick={() => setUpcomingOnly(false)}>All</Button>
        <Button type="button" size="sm" variant={upcomingOnly ? "default" : "outline"} onClick={() => setUpcomingOnly(true)}>Upcoming{upcomingCount ? ` (${upcomingCount})` : ""}</Button>
      </div>
      {upcomingOnly && shownOrders.length === 0 ? <p className="text-sm text-muted-foreground">No upcoming scheduled orders.</p> : null}
      {shownOrders.map((order) => {
        const { date: orderDate, time: orderTime } = orderDateParts(order.createdAt);
        const address = [order.addressLine, order.area].filter(Boolean).join(", ");

        return (
          <Card key={order.id} className={order.unreadMessages > 0 ? "overflow-hidden border-destructive/60 shadow-card transition-colors" : "overflow-hidden transition-colors hover:border-primary/40"}>
            <CardContent className="p-0">
              <Link
                to="/owner/orders/$orderId"
                params={{ orderId: order.id }}
                search={{}}
                className="block p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-5"
                aria-label={`View order ${order.code}`}
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="break-all font-display text-base font-black text-foreground">
                        {order.code}
                      </p>
                      <Badge variant="secondary" className="shrink-0 capitalize">
                        {order.fulfillment}
                      </Badge>
                      {order.unreadMessages > 0 ? <Badge variant="destructive" className="shrink-0 gap-1"><MessageCircle className="size-3" />{order.unreadMessages} unread</Badge> : null}
                    </div>
                    {order.scheduledFor ? (
                      <p className="mt-2 text-sm font-semibold text-primary">Scheduled for {formatScheduled(order.scheduledFor)} · Payment: {order.paymentStatus}</p>
                    ) : null}
                    <p className="mt-2 truncate text-sm font-bold">{order.customerName}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {order.customerPhone}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-lg font-black">{formatTaka(order.total)}</p>
                    <Badge
                      variant={order.status === "cancelled" ? "destructive" : order.status === "placed" ? "default" : "secondary"}
                      className={cn(
                        "mt-1",
                        order.status === "completed" &&
                          "border-success/40 bg-success text-success-foreground hover:bg-success/90",
                      )}
                    >
                      {statusLabel(order.status, order.fulfillment)}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-muted-foreground sm:flex sm:flex-wrap">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" /> {orderDate}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Clock3 className="size-3.5 shrink-0" aria-hidden="true" /> {orderTime}
                  </span>
                  <span className="col-span-2 flex min-w-0 items-center gap-1.5 sm:max-w-md">
                    <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {order.fulfillment === "delivery" ? address || "Address unavailable" : "Restaurant pickup"}
                    </span>
                  </span>
                </div>

                <span className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium sm:w-auto">
                  View Order <ChevronRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
