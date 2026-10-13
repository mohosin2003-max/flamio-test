import type { FulfillmentType } from "@/types/menu";

/** Canonical order lifecycle used by both the customer app and the backend. */
export type OrderStatus =
  | "scheduled"
  | "placed"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "completed"
  | "cancelled";

const LABELS: Record<OrderStatus, string> = {
  scheduled: "Scheduled",
  placed: "Order placed",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function statusLabel(status: string, fulfillment?: FulfillmentType): string {
  if (status === "ready" && fulfillment === "pickup") return "Ready for pickup";
  return LABELS[status as OrderStatus] ?? status;
}

/** Steps shown in tracking. Pickup orders skip the delivery leg. */
export function statusFlow(fulfillment: FulfillmentType): OrderStatus[] {
  return fulfillment === "pickup"
    ? ["placed", "confirmed", "preparing", "ready", "completed"]
    : ["placed", "confirmed", "preparing", "ready", "out_for_delivery", "completed"];
}

export function statusIndex(status: string, fulfillment: FulfillmentType): number {
  return statusFlow(fulfillment).indexOf(status as OrderStatus);
}

export function isCancelled(status: string): boolean {
  return status === "cancelled";
}

export function isActiveOrder(status: string): boolean {
  return status !== "completed" && status !== "cancelled";
}
