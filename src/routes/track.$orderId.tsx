import { useState } from "react";
import { formatScheduled } from "@/lib/opening-hours";
import { Link, createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";

import { OrderPhoneVerify } from "@/components/order/OrderPhoneVerify";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { OrderTimeline } from "@/components/order/OrderTimeline";
import { cn } from "@/lib/utils";
import { formatOrderDate } from "@/lib/orders";
import { isActiveOrder, isCancelled, statusLabel } from "@/lib/order-status";
import { useOrder } from "@/lib/use-order";

export const Route = createFileRoute("/track/$orderId")({
  head: () => ({
    meta: [
      { title: "Track Order — Flamio" },
      { name: "description", content: "Follow the progress of your Flamio order in real time." },
      { property: "og:title", content: "Track Order — Flamio" },
      { property: "og:description", content: "Follow the progress of your Flamio order." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackOrderPage,
});

function TrackOrderPage() {
  const { orderId } = Route.useParams();
  const [phoneLast4, setPhoneLast4] = useState("");
  const { order, ready, error, refreshing, refresh, requiresPhone } = useOrder(
    orderId,
    phoneLast4 || undefined,
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 pb-32 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-black sm:text-4xl">Track Order</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {order
          ? `Current status: ${statusLabel(order.status, order.fulfillment)}`
          : "Follow your order from the kitchen to your door."}
      </p>

      {!ready ? (
        <div className="mt-6 h-72 animate-pulse rounded-2xl border border-border/70 bg-card" />
      ) : requiresPhone ? (
        <OrderPhoneVerify onSubmit={setPhoneLast4} wrong={phoneLast4.length === 4} />
      ) : error ? (
        <div className="mt-6">
          <EmptyState
            title="We couldn't load this order"
            description="Please check your connection and try again."
            action={<Button onClick={refresh}>Try again</Button>}
          />
        </div>
      ) : !order ? (
        <div className="mt-6">
          <EmptyState
            title="Order not found"
            description="This order doesn't exist or belongs to another account."
            action={
              <Button asChild>
                <Link to="/account/orders">My Orders</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <section className="mt-6 rounded-2xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="break-all font-display text-lg font-extrabold text-gradient-ember">
              {order.code}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatOrderDate(order.createdAt)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                isCancelled(order.status)
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-primary/40 bg-secondary",
              )}
            >
              {statusLabel(order.status, order.fulfillment)}
            </span>
            <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold capitalize text-muted-foreground">
              {order.fulfillment === "delivery" ? "Delivery" : "Pickup"}
            </span>
            {order.estimatedTime ? (
              <span className="text-xs text-muted-foreground">Est. {order.estimatedTime}</span>
            ) : null}
          </div>

          <div className="mt-6">
            {(order as { scheduledFor?: string | null }).scheduledFor ? (<p className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold">Scheduled for {formatScheduled((order as { scheduledFor: string }).scheduledFor)}</p>) : null}
            <OrderTimeline status={order.status} fulfillment={order.fulfillment} scheduled={Boolean((order as { scheduledFor?: string | null }).scheduledFor)} />
          </div>

          {isActiveOrder(order.status) ? (
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-border/70 pt-4">
              <p className="text-xs text-muted-foreground">
                Status updates automatically every few seconds.
              </p>
              <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />
                Refresh
              </Button>
            </div>
          ) : null}
        </section>
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        {order ? (
          <Button asChild size="lg" variant="outline" className="w-full sm:flex-1">
            <Link to="/order/$orderId" params={{ orderId: order.id }}>
              Order details
            </Link>
          </Button>
        ) : null}
        <Button asChild size="lg" className="w-full shadow-ember sm:flex-1">
          <Link to="/account/orders">My Orders</Link>
        </Button>
      </div>
    </div>
  );
}
