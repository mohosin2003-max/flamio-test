import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, MessageCircle, Phone, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { OrderMessages } from "@/components/order/OrderMessages";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import {
  canCancelOrder,
  channelLabel,
  isOnlineChannel,
  nextActionLabel,
  nextOrderStatus,
} from "@/lib/order-flow";
import { ownerUpdateOrderStatus, type OwnerOrderRow } from "@/lib/owner.functions";
import { canManage as canManagePermission } from "@/lib/permissions";
import { ownerAssignRider, ownerListRiders } from "@/lib/riders.functions";
import { cn } from "@/lib/utils";

export function OwnerOrderActions({ order, messageOpenInitially = false }: { order: OwnerOrderRow; messageOpenInitially?: boolean }) {
  const updateStatus = useServerFn(ownerUpdateOrderStatus);
  const assignRider = useServerFn(ownerAssignRider);
  const listRiders = useServerFn(ownerListRiders);
  const queryClient = useQueryClient();
  const access = useDashboardAccess();
  const [pending, setPending] = useState(false);
  const [riderPending, setRiderPending] = useState(false);
  const [threadOpen, setThreadOpen] = useState(messageOpenInitially);
  const [scrollToThread, setScrollToThread] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const canManage = canManagePermission(access.data, "order_management");
  const counterSale = !isOnlineChannel(order.channel);
  const next = counterSale || !canManage ? null : nextOrderStatus(order.status, order.fulfillment);
  const cancellable = canManage && canCancelOrder(order.status, order.channel);
  const hasCustomerNote = Boolean(order.deliveryNotes?.trim());
  const hasCustomerAlert = hasCustomerNote || order.hasCustomerMessage === true || order.unreadMessages > 0;

  useEffect(() => {
    if (scrollToThread && threadRef.current) {
      threadRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setScrollToThread(false);
    }
  }, [scrollToThread]);

  const riders = useQuery({
    queryKey: ["owner-riders"],
    queryFn: () => listRiders(),
    enabled: canManage && canManagePermission(access.data, "riders"),
  });
  const activeRiders = (riders.data ?? []).filter((rider) => rider.isActive);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["owner-orders"] }),
      queryClient.invalidateQueries({ queryKey: ["owner-order", order.id] }),
    ]);
  };

  const move = async (status: "cancelled" | NonNullable<typeof next>) => {
    setPending(true);
    try {
      await updateStatus({ data: { orderId: order.id, status } });
      await refresh();
      toast.success(status === "cancelled" ? "Order cancelled" : "Order updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update this order");
    } finally {
      setPending(false);
    }
  };

  return (
    <section aria-labelledby={`actions-${order.id}`}>
      <h2 id={`actions-${order.id}`} className="text-xs font-bold uppercase text-muted-foreground">Actions</h2>

      {counterSale ? (
        <p className="mt-2 text-sm text-muted-foreground">{channelLabel(order.channel)} — completed sale</p>
      ) : next ? (
        <Button
          size="lg"
          className="mt-2 min-h-14 w-full text-base font-black shadow-ember sm:text-lg"
          disabled={pending}
          onClick={() => void move(next)}
        >
          {next === "ready" ? "READY" : nextActionLabel(next, order.fulfillment)}
          <ChevronRight aria-hidden="true" />
        </Button>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {isOnlineChannel(order.channel) ? (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={`tel:${order.customerPhone}`}><Phone aria-hidden="true" /> Call Customer</a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={cn(
                "relative overflow-visible",
                hasCustomerAlert && "message-alert border-destructive bg-destructive/10 font-bold text-destructive hover:bg-destructive/20 hover:text-destructive",
              )}
              onClick={() => {
                setThreadOpen((wasOpen) => {
                  if (!wasOpen) setScrollToThread(true);
                  return !wasOpen;
                });
              }}
              aria-expanded={threadOpen}
            >
              <span className="relative overflow-visible">
                <MessageCircle
                  className={cn(
                    "h-4 w-4",
                    hasCustomerAlert && "text-destructive",
                  )}
                  aria-hidden="true"
                />
                {hasCustomerAlert ? (
                  <span className="absolute -right-2 -top-2 z-20 flex size-3.5 rounded-full border-2 border-background bg-destructive" aria-hidden="true" />
                ) : null}
              </span>
              {hasCustomerAlert ? "Customer Message" : "Message Customer"}
              {order.unreadMessages > 0 ? ` (${order.unreadMessages})` : ""}
            </Button>
          </>
        ) : null}

        {cancellable ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Cancel order ${order.code}? This can't be undone.`)) void move("cancelled");
            }}
          >
            <XCircle aria-hidden="true" /> Cancel Order
          </Button>
        ) : null}
      </div>

      {canManage && canManagePermission(access.data, "riders") && order.fulfillment === "delivery" && isOnlineChannel(order.channel) ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[auto_minmax(0,15rem)_1fr] sm:items-center">
          <span className="text-xs font-semibold text-muted-foreground">Assign Rider</span>
          <Select
            value={order.riderId ?? "none"}
            disabled={riderPending}
            onValueChange={async (value) => {
              setRiderPending(true);
              try {
                await assignRider({ data: { orderId: order.id, riderId: value === "none" ? null : value } });
                await refresh();
                toast.success(value === "none" ? "Rider cleared" : "Rider assigned");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Couldn't assign this rider");
              } finally {
                setRiderPending(false);
              }
            }}
          >
            <SelectTrigger className="h-11 w-full"><SelectValue placeholder="Assign rider" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No rider</SelectItem>
              {activeRiders.map((rider) => <SelectItem key={rider.id} value={rider.id}>{rider.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {activeRiders.length === 0 ? <span className="text-xs text-muted-foreground">Add riders in the Riders tab</span> : null}
        </div>
      ) : null}

      {threadOpen ? (
        <div ref={threadRef} className="mt-4 rounded-lg border border-border/70 bg-background p-3 shadow-card">
          <OrderMessages orderId={order.id} autoFocus={messageOpenInitially} customerName={order.customerName} ownerView />
        </div>
      ) : null}
    </section>
  );
}