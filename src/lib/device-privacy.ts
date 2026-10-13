/**
 * Removes every piece of customer data this app keeps on the device, so the
 * next person using the same phone/browser never sees it. Database-stored
 * addresses and orders are NOT touched.
 */
export const SIGNED_OUT_EVENT = "flamio:signed-out";

const DEVICE_KEYS = [
  "flamio.addresses.v1",
  "flamio.orders.v1",
  "flamio.location.v1",
  "flamio.cart.v1",
];

export function clearCustomerDeviceData(): void {
  if (typeof window === "undefined") return;
  for (const key of DEVICE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  try {
    window.sessionStorage.removeItem("flamio.pending-checkout.v1");
  } catch {
    /* storage unavailable */
  }
  try {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  } catch {
    /* ignore */
  }
}
