import { supabase } from "@/integrations/supabase/client";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CustomerNote, StaffOrderItemList, orderDateParts } from "@/components/order/StaffOrderDetails";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getKitchenAccess,
  kitchenListInventory,
  kitchenListOrders,
  kitchenUpdateOrderStatus,
} from "@/lib/kitchen.functions";
import { beep } from "@/lib/order-alarm";
import { statusLabel } from "@/lib/order-status";

/**
 * Kitchen Display System. Reuses the existing kitchen server functions, the
 * existing order status lifecycle and the same 20s polling pattern as the
 * Owner Orders screen — no parallel order, status or polling architecture.
 */
export const Route = createFileRoute("/_authenticated/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen Display — Flamio" },
      { name: "description", content: "Live kitchen queue for Flamio staff." },
      { property: "og:title", content: "Kitchen Display — Flamio" },
      { property: "og:description", content: "Live kitchen queue for Flamio staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: KitchenPage,
});

/** Next kitchen action for the current status. Delivery dispatch stays owner-side. */
const NEXT: Record<string, { status: "confirmed" | "preparing" | "ready"; label: string }> = {
  placed: { status: "confirmed", label: "Confirm order" },
  confirmed: { status: "preparing", label: "Start preparing" },
  preparing: { status: "ready", label: "Mark ready" },
};

function KitchenPage() {
  const fetchAccess = useServerFn(getKitchenAccess);
  const listOrders = useServerFn(kitchenListOrders);
  const updateStatus = useServerFn(kitchenUpdateOrderStatus);
  const listStock = useServerFn(kitchenListInventory);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [newIds, setNewIds] = useState<string[]>([]);
  const seenRef = useRef<Set<string> | null>(null);

  const access = useQuery({
    queryKey: ["kitchen-access"],
    queryFn: async () => {
      // Skip when the session just ended (e.g. during logout).
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      return fetchAccess();
    },
    retry: false,
    staleTime: 60 * 1000,
  });

  const orders = useQuery({
    queryKey: ["kitchen-orders"],
    queryFn: () => listOrders(),
    refetchInterval: 20_000,
    enabled: Boolean(access.data?.hasAccess),
  });

  const stock = useQuery({
    queryKey: ["kitchen-inventory"],
    queryFn: () => listStock(),
    refetchInterval: 60_000,
    enabled: Boolean(access.data?.hasAccess),
  });

  // New-order alert: compares IDs between polls, browser-side only.
  useEffect(() => {
    const data = orders.data;
    if (!data) return;
    const ids = data.map((o) => o.id);
    if (seenRef.current === null) {
      seenRef.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seenRef.current!.has(id));
    seenRef.current = new Set(ids);
    if (fresh.length === 0) return;
    setNewIds(fresh);
    if (soundOn) beep();
    const t = setTimeout(() => setNewIds([]), 15_000);
    return () => clearTimeout(t);
  }, [orders.data, soundOn]);

  if (access.isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!access.data?.hasAccess) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
            <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-lg font-bold">Kitchen access required</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            This screen is for Flamio kitchen staff. Ask the owner to give your account kitchen
            access.
          </p>
          <Button className="mt-5" variant="secondary" onClick={() => void access.refetch()}>
            Check again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black">Kitchen Display</h1>
          <p className="text-sm text-muted-foreground">
            Live queue · refreshes every 20s
            {orders.isFetching ? (
              <Loader2 aria-hidden="true" className="ml-2 inline size-3.5 animate-spin" />
            ) : null}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSoundOn((v) => !v)}
          aria-label={soundOn ? "Mute new order alert" : "Unmute new order alert"}
        >
          {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </header>

      {newIds.length > 0 ? (
        <div className="rounded-xl border border-primary/50 bg-primary/10 px-4 py-3 text-sm font-semibold text-primary">
          {newIds.length} new order{newIds.length > 1 ? "s" : ""} received
        </div>
      ) : null}

      {orders.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : orders.error ? (
        <EmptyState
          title="Couldn't load the kitchen queue"
          description="Please try again."
          action={<Button onClick={() => void orders.refetch()}>Retry</Button>}
        />
      ) : !orders.data?.length ? (
        <EmptyState title="No active orders" description="New orders will appear here." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {orders.data.map((order) => {
            const next =
              order.status === "ready" && order.fulfillment === "pickup"
                ? ({ status: "completed", label: "Complete pickup" } as const)
                : NEXT[order.status];
            const isNew = newIds.includes(order.id);
            return (
              <li key={order.id}>
                <Card className={isNew ? "border-primary shadow-ember" : undefined}>
                  <CardContent className="space-y-3 p-4">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="min-w-0">
                        <p className="break-all font-display font-bold">{order.code}</p>
                        <p className="text-xs text-muted-foreground">
                          {orderDateParts(order.createdAt).time} ·{" "}
                          <span className="capitalize">{order.fulfillment}</span>
                        </p>
                      </div>
                      <Badge className="shrink-0">{statusLabel(order.status, order.fulfillment)}</Badge>
                    </div>

                    <CustomerNote note={order.deliveryNotes} />
                    <StaffOrderItemList items={order.items} />

                    {next ? (
                      <Button
                        className="min-h-14 w-full text-base font-black shadow-ember sm:text-lg"
                        disabled={pending === order.id}
                        onClick={async () => {
                          setPending(order.id);
                          try {
                            await updateStatus({
                              data: { orderId: order.id, status: next.status },
                            });
                            await queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
                            toast.success(`Order ${order.code}: ${next.label.toLowerCase()}`);
                          } catch (error) {
                            toast.error(
                              error instanceof Error ? error.message : "Couldn't update this order",
                            );
                          } finally {
                            setPending(null);
                          }
                        }}
                      >
                        {pending === order.id ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : null}
                        {next.status === "ready" ? "READY" : next.label}
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <section className="space-y-3 pt-2">
        <h2 className="font-display text-lg font-bold">Ingredient stock</h2>
        {stock.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : stock.error ? (
          <EmptyState
            title="Couldn't load ingredient stock"
            description="Please try again."
            action={<Button onClick={() => void stock.refetch()}>Retry</Button>}
          />
        ) : !stock.data?.length ? (
          <EmptyState
            title="No ingredients tracked"
            description="The owner can add ingredients from the dashboard."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">{stock.data.length} available</Badge>
              <Badge variant="secondary">
                {stock.data.filter((s) => s.isLow).length} low stock
              </Badge>
              <Badge variant="destructive">
                {stock.data.filter((s) => s.isOut).length} out of stock
              </Badge>
            </div>
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {stock.data.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{row.name}</span>
                      {row.isOut ? (
                        <Badge variant="destructive" className="text-[10px]">
                          OUT OF STOCK
                        </Badge>
                      ) : row.isLow ? (
                        <Badge variant="secondary" className="text-[10px]">
                          LOW STOCK
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">
                        {row.currentStock} {row.unit} available
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.usedToday} {row.unit} used in last day
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
