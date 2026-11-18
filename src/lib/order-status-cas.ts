/**
 * Compare-and-set result check for order status updates. The update is
 * filtered by the expected previous status; if no row came back, the order
 * changed concurrently (cancelled, advanced) and the caller must see a conflict.
 */
export const STALE_ORDER_MESSAGE =
  "This order was already updated or cancelled by someone else. Please refresh.";

export function assertStatusUpdateApplied(
  rows: Array<{ id: string; status: string }> | null | undefined,
  expected: string,
): void {
  if (!rows || rows.length !== 1 || rows[0]?.status !== expected) {
    throw new Error(STALE_ORDER_MESSAGE);
  }
}
