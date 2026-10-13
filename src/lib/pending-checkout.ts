import type { CustomerAddress, FulfillmentType } from "@/types/menu";

/**
 * Temporary Checkout state kept only while a guest signs in / signs up from
 * Checkout. Tab-scoped (sessionStorage), removed once restored and on every
 * sign-out cleanup. Never a long-term address or order store.
 */
const KEY = "flamio.pending-checkout.v1";

export type PendingCheckout = {
  form: CustomerAddress;
  point: { lat: number; lng: number } | null;
  fulfillment: FulfillmentType;
  method: string;
  zoneId: string | null;
  couponCode: string | null;
  /** Chosen scheduled pre-order slot (ISO), if any. */
  scheduledFor?: string | null;
};

export function savePendingCheckout(state: PendingCheckout): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

export function readPendingCheckout(): PendingCheckout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PendingCheckout) : null;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
