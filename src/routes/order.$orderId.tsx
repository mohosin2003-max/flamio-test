import { useState } from "react";
import { formatScheduled } from "@/lib/opening-hours";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Clock, ListChecks, MapPin, MessageCircle, Receipt, Wallet } from "lucide-react";

import { OrderPhoneVerify } from "@/components/order/OrderPhoneVerify";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { formatBDT } from "@/lib/format";
import { formatOrderDate } from "@/lib/orders";
import { OrderTimeline } from "@/components/order/OrderTimeline";
import { isCancelled, statusLabel } from "@/lib/order-status";
import { cn } from "@/lib/utils";
import { useOrder } from "@/lib/use-order";
import { OrderMessages } from "@/components/order/OrderMessages";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/order/$orderId")({
  head: () => ({
    meta: [
      { title: "Order Placed — Flamio" },
      {
        name: "description",
        content: "Your Flamio order is confirmed. View your order ID, items, delivery and total.",
      },
      { property: "og:title", content: "Order Placed — Flamio" },
      { property: "og:description", content: "Your Flamio order is confirmed." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OrderSuccessPage,
});

function OrderSuccessPage() {
  const { orderId } = Route.useParams();
  const [phoneLast4, setPhoneLast4] = useState("");
  const { order, ready, requiresPhone } = useOrder(orderId, phoneLast4 || undefined);
  const { isAuthenticated } = useAuth();

  if (!ready) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <div className="h-64 animate-pulse rounded-2xl border border-border/70 bg-card" />
      </div>
    );
  }

  if (requiresPhone) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <OrderPhoneVerify onSubmit={setPhoneLast4} wrong={phoneLast4.length === 4} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
        <EmptyState
          title="Order not found"
          description="We couldn't find this order on this device. It may have been placed elsewhere."
          action={
            <Button asChild>
              <Link to="/menu" search={{}}>
                Back to menu
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  const isDelivery = order.fulfillment === "delivery";

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 pb-32 sm:px-6 sm:py-14">
      <section className="rounded-3xl border border-border/70 bg-card p-6 text-center shadow-card sm:p-10">
        <span className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <span className="absolute inset-2 rounded-full bg-primary/15" />
          <CheckCircle2 className="relative h-12 w-12 text-primary" strokeWidth={2.2} />
        </span>
        <h1 className="mt-5 font-display text-2xl font-black sm:text-3xl">
          Order Placed Successfully
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Thank you for ordering with Flamio. Your food is being prepared fresh — we'll have it
          ready shortly.
        </p>

        <div className="mt-6 inline-flex flex-col items-center gap-1 rounded-2xl border border-border/70 bg-secondary/40 px-6 py-4">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Order ID</span>
          <span className="break-all font-display text-xl font-extrabold text-gradient-ember">
            {order.code}
          </span>
          <span className="text-xs text-muted-foreground">{formatOrderDate(order.createdAt)}</span>
          <span className="mt-2 flex flex-wrap justify-center gap-2">
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
            <span className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground">
              {isDelivery ? "Delivery" : "Pickup"}
            </span>
          </span>
        </div>
      </section>

      {(order.channel ?? "online") === "online" ? (
        <section className="mt-6 rounded-2xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
            <ListChecks className="h-4 w-4 text-primary" /> Order status
          </h2>
          <div className="mt-4">
            {(order as { scheduledFor?: string | null }).scheduledFor ? (<p className="mb-3 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-semibold">Scheduled for {formatScheduled((order as { scheduledFor: string }).scheduledFor)}</p>) : null}
            <OrderTimeline status={order.status} fulfillment={order.fulfillment} compact scheduled={Boolean((order as { scheduledFor?: string | null }).scheduledFor)} />
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4 w-full sm:w-auto">
            <Link to="/track/$orderId" params={{ orderId: order.id }}>
              Live tracking
            </Link>
          </Button>
        </section>
      ) : null}

      {isAuthenticated && (order.channel ?? "online") === "online" ? (
        <section className="mt-6 rounded-2xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
            <MessageCircle className="h-4 w-4 text-primary" /> Message about this order
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This conversation stays attached to {order.code} only.
          </p>
          <div className="mt-4">
            <OrderMessages orderId={order.id} />
          </div>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-border/70 bg-card p-5 shadow-card sm:p-6">
        <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
          <Receipt className="h-4 w-4 text-primary" /> Order summary
        </h2>
        <ul className="mt-4 space-y-3 text-sm">
          {order.items.map((line) => (
            <li key={line.lineId} className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                <span className="font-medium text-foreground">{line.productName}</span>
                {line.variantName ? <span className="block text-xs">{line.variantName}</span> : null}
                <span className="block text-xs">
                  {line.quantity} × {formatBDT(line.unitPrice)}
                </span>
              </span>
              <span className="font-medium">{formatBDT(line.unitPrice * line.quantity)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-border/70 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="font-medium">{formatBDT(order.subtotal)}</dd>
          </div>
          {order.discount > 0 ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd className="font-medium">−{formatBDT(order.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {isDelivery ? "Delivery charge" : "Delivery (pickup)"}
            </dt>
            <dd className="font-medium">
              {order.deliveryCharge === 0 && isDelivery
                ? "Free"
                : formatBDT(order.deliveryCharge)}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
          <span className="font-semibold">Total</span>
          <span className="font-display text-xl font-extrabold text-gradient-ember">
            {formatBDT(order.total)}
          </span>
        </div>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 font-display text-base font-extrabold">
            <MapPin className="h-4 w-4 text-primary" />
            {isDelivery ? "Delivery address" : "Pickup"}
          </h2>
          {isDelivery && order.address ? (
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{order.address.fullName}</p>
              <p>{order.address.phone}</p>
              <p>
                {[order.address.addressLine, order.address.area, order.address.landmark]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              {order.zoneName ? <p className="text-xs">Zone: {order.zoneName}</p> : null}
              {order.address.deliveryNotes ? (
                <p className="text-xs">Note: {order.address.deliveryNotes}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              {order.address?.fullName ? (
                <p className="font-medium text-foreground">{order.address.fullName}</p>
              ) : null}
              {order.address?.phone ? <p>{order.address.phone}</p> : null}
              <p>{order.pickupNote ?? "Collect your order from the restaurant."}</p>
            </div>
          )}
          {order.estimatedTime ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Estimated: {order.estimatedTime}
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 font-display text-base font-extrabold">
            <Wallet className="h-4 w-4 text-primary" /> Payment method
          </h2>
          <p className="mt-3 text-sm font-medium">{order.paymentLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {order.fulfillment === "delivery"
              ? "Pay the rider when your order arrives."
              : "Pay at the counter when you collect."}
          </p>
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button asChild size="lg" className="w-full shadow-ember sm:flex-1">
          <Link to="/track/$orderId" params={{ orderId: order.id }}>
            Track Order
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="w-full sm:flex-1">
          <Link to="/account/orders">My Orders</Link>
        </Button>
      </div>
    </div>
  );
}
