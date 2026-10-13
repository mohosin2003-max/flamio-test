import type { FulfillmentType } from "@/types/menu";
import type { OrderStatus } from "@/lib/order-status";

/**
 * Forward-only order lifecycle, shared by the UI and the server functions.
 * The same rules are enforced again by a database trigger, so a direct API
 * call cannot move an order backwards either.
 */

/** Where the sale came from. Counter/platform sales are completed at the till. */
export type OrderChannel = "online" | "counter" | "platform";

const DELIVERY_FLOW: OrderStatus[] = [
  "placed",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
];

const PICKUP_FLOW: OrderStatus[] = ["placed", "confirmed", "preparing", "ready", "completed"];

export function orderFlow(fulfillment: FulfillmentType): OrderStatus[] {
  return fulfillment === "delivery" ? DELIVERY_FLOW : PICKUP_FLOW;
}

/** Only the immediate next status is ever allowed. */
export function nextOrderStatus(
  status: string,
  fulfillment: FulfillmentType,
): OrderStatus | null {
  const flow = orderFlow(fulfillment);
  const index = flow.indexOf(status as OrderStatus);
  if (index < 0 || index >= flow.length - 1) return null;
  return flow[index + 1] ?? null;
}

export function isForwardTransition(
  from: string,
  to: string,
  fulfillment: FulfillmentType,
): boolean {
  return nextOrderStatus(from, fulfillment) === to;
}

/** Button label for the single next step. */
export function nextActionLabel(next: OrderStatus, fulfillment: FulfillmentType): string {
  switch (next) {
    case "confirmed":
      return "Confirm Order";
    case "preparing":
      return "Start Preparing";
    case "ready":
      return fulfillment === "pickup" ? "Ready for Pickup" : "Mark Ready";
    case "out_for_delivery":
      return "Out for Delivery";
    case "completed":
      return fulfillment === "delivery" ? "Delivered" : "Completed";
    default:
      return "Next step";
  }
}

export function isOnlineChannel(channel: string | null | undefined): boolean {
  return (channel ?? "online") === "online";
}

/** Counter and platform sales are final; online orders can still be cancelled. */
export function canCancelOrder(status: string, channel: string | null | undefined): boolean {
  if (!isOnlineChannel(channel)) return false;
  return status !== "completed" && status !== "cancelled";
}

export function channelLabel(channel: string | null | undefined): string {
  if (channel === "counter") return "Counter sale";
  if (channel === "platform") return "Platform sale";
  return "Online order";
}
