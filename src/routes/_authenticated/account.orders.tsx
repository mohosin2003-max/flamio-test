import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { useCart } from "@/context/cart";
import { listMyOrders, type MyOrder } from "@/lib/account.functions";
import { formatBDT } from "@/lib/format";
import { menuQueryOptions } from "@/lib/menu-repository";
import { isActiveOrder, isCancelled, statusLabel } from "@/lib/order-status";
import { formatOrderDate } from "@/lib/orders";
import { formatScheduled } from "@/lib/opening-hours";
import { buildReorderPlan } from "@/lib/reorder";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/menu";

export const Route = createFileRoute("/_authenticated/account/orders")({
  head: () => ({
    meta: [
      { title: "My Orders — Flamio" },
      { name: "description", content: "View your active and previous Flamio orders, track status and reorder." },
      { property: "og:title", content: "My Orders — Flamio" },
      { property: "og:description", content: "View your active and previous Flamio orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyOrdersPage,
});

type Tab = "active" | "previous";

function MyOrdersPage() {
  const fetchOrders = useServerFn(listMyOrders);
  const [tab, setTab] = useState<Tab>("active");

  const ordersQuery = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => fetchOrders(),
    staleTime: 15 * 1000,
  });

  const menuQuery = useQuery(menuQueryOptions());
  const orders = ordersQuery.data ?? [];

  const { active, previous } = useMemo(
    () => ({
      active: orders.filter((o) => isActiveOrder(o.status)),
      previous: orders.filter((o) => !isActiveOrder(o.status)),
    }),
    [orders],
  );

  const shown = tab === "active" ? active : previous;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-black sm:text-4xl">My Orders</h1>
        <Button asChild variant="ghost" size="sm">
          <Link to="/account">Account</Link>
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
        {(
          [
            { id: "active" as const, label: `Active (${active.length})` },
            { id: "previous" as const, label: `Previous (${previous.length})` },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-semibold transition-smooth",
              tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ordersQuery.isPending ? (
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-2xl border border-border/70 bg-card" />
          ))}
        </div>
      ) : ordersQuery.isError ? (
        <div className="mt-6">
          <EmptyState
            title="We couldn't load your orders"
            description="Please check your connection and try again."
            action={<Button onClick={() => void ordersQuery.refetch()}>Try again</Button>}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={tab === "active" ? "No active orders" : "No previous orders yet"}
            description={
              tab === "active"
                ? "When you place an order it will appear here with live status."
                : "Completed and cancelled orders will be listed here."
            }
            action={
              <Button asChild>
                <Link to="/menu" search={{}}>
                  Browse the menu
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {shown.map((order) => (
            <OrderCard key={order.id} order={order} products={menuQuery.data?.products ?? []} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({
  order,
  products,
}: {
  order: MyOrder;
  products: Product[];
}) {
  const { addItem } = useCart();
  const navigate = useNavigate();

  const summary = order.items
    .map((i) => `${i.quantity}× ${i.productName}`)
    .join(", ");

  function handleReorder() {
    if (products.length === 0) {
      toast.error("The menu is still loading. Please try again in a moment.");
      return;
    }
    const plan = buildReorderPlan(order.items, products);
    if (plan.add.length === 0) {
      toast.error("None of these items are available right now.");
      return;
    }
    plan.add.forEach((entry) => addItem(entry.product, entry.variant, entry.quantity));
    if (plan.unavailable.length > 0) {
      toast.warning(`Not available anymore: ${plan.unavailable.join(", ")}`);
    }
    toast.success("Items added to your cart at current prices");
    void navigate({ to: "/cart" });
  }

  return (
    <li className="rounded-2xl border border-border/70 bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="break-all font-display text-base font-extrabold text-gradient-ember">
          {order.code}
        </span>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-semibold",
            isCancelled(order.status)
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-secondary text-foreground",
          )}
        >
          {statusLabel(order.status, order.fulfillment)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{formatOrderDate(order.createdAt)}</span>
        {order.scheduledFor ? <span className="text-xs font-semibold text-primary">Scheduled for {formatScheduled(order.scheduledFor)}</span> : null}
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          {order.fulfillment === "delivery" ? "Delivery" : "Pickup"}
        </span>
      </div>
      <p className="mt-2 break-words text-sm text-muted-foreground">{summary}</p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
        <span className="text-sm font-bold">{formatBDT(order.total)}</span>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary">
            <Link to="/order/$orderId" params={{ orderId: order.id }}>
              View details
            </Link>
          </Button>
          {order.status === "completed" ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/account/review/$orderId" params={{ orderId: order.id }}>
                Rate order
              </Link>
            </Button>
          ) : null}
          {isActiveOrder(order.status) ? (
            <Button asChild size="sm" variant="outline">
              <Link to="/track/$orderId" params={{ orderId: order.id }}>
                Track
              </Link>
            </Button>
          ) : !isCancelled(order.status) ? (

            <Button size="sm" onClick={handleReorder}>
              <RotateCcw aria-hidden="true" /> Reorder
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleReorder}>
              <RotateCcw aria-hidden="true" /> Reorder
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
