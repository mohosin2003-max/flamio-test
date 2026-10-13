import type { CartLine, CustomerAddress, FulfillmentType, PaymentMethodId } from "@/types/menu";

/**
 * Placed-order store. Local for now (database-ready shape) so the success
 * page survives refreshes and direct links without inventing data.
 */
const STORAGE_KEY = "flamio.orders.v1";

export interface PlacedOrder {
  id: string;
  code: string;
  createdAt: string;
  fulfillment: FulfillmentType;
  paymentMethod: PaymentMethodId;
  paymentLabel: string;
  items: CartLine[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  estimatedTime: string | null;
  scheduledFor?: string | null;
  zoneName: string | null;
  address: CustomerAddress | null;
  pickupNote: string | null;
  status: string;
  channel?: "online" | "counter" | "platform";
}

export function generateOrderCode(date = new Date()): string {
  const stamp = [
    date.getFullYear().toString().slice(-2),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 46656)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `FLM-${stamp}-${random}`;
}

export function loadOrders(): PlacedOrder[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PlacedOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveOrder(order: PlacedOrder): void {
  try {
    const next = [order, ...loadOrders().filter((o) => o.id !== order.id)].slice(0, 25);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable – the order still shows for this session */
  }
}

export function findOrder(id: string): PlacedOrder | null {
  return loadOrders().find((o) => o.id === id || o.code === id) ?? null;
}

export function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
