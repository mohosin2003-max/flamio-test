/**
 * Step 4B financial authority + idempotency helpers (PURE, client-safe).
 *
 * - applyAuthoritativePrices: every non-combo ONLINE line is re-priced from the
 *   database row (product base_price, or the variant's price). Any unitPrice
 *   the browser sent is ignored. Combo lines are priced by validateComboItems.
 * - Idempotency: a per-request key lets a lost-response retry get the original
 *   order back instead of creating a second one. Until the inactive SQL draft
 *   (orders.idempotency_key + partial unique index) is approved and applied,
 *   the server enforces this with a per-worker in-memory ledger only — a
 *   best-effort guard, NOT a cross-worker database guarantee.
 * - TEST business rule: coupon + Burger Boost reward reservation = REJECT.
 */
import { RELEASE_LOCKS } from "./burger-boost-reward-flow";

export type PriceableLine = {
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  comboKey?: string | null | undefined;
};

export type ProductPriceRow = { id: string; base_price: number | string; is_available: boolean };
export type VariantPriceRow = {
  id: string;
  product_id: string;
  name: string;
  price: number | string;
  is_available: boolean;
};

export function applyAuthoritativePrices<T extends PriceableLine>(
  lines: readonly T[],
  products: readonly ProductPriceRow[],
  variants: readonly VariantPriceRow[],
): T[] {
  const byProduct = new Map(products.map((p) => [p.id, p]));
  const byVariant = new Map(variants.map((v) => [v.id, v]));
  return lines.map((line) => {
    if (line.comboKey) return { ...line }; // priced by validateComboItems
    const product = byProduct.get(line.productId);
    if (!product || !product.is_available) {
      throw new Error(`${line.productName} is no longer available. Please update your cart.`);
    }
    if (line.variantId) {
      const v = byVariant.get(line.variantId);
      if (!v || v.product_id !== line.productId || !v.is_available) {
        throw new Error(
          `${line.productName} option is no longer available. Please update your cart.`,
        );
      }
      return { ...line, unitPrice: Number(v.price), variantName: v.name };
    }
    return { ...line, unitPrice: Number(product.base_price) };
  });
}

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function orderIdempotencyColumns(
  key: string | null | undefined,
): Record<string, string | null> {
  if (key != null && !IDEMPOTENCY_KEY_RE.test(key)) throw new Error("Invalid order request id.");
  return { idempotency_key: key ?? null };
}

export function checkoutRewardSearch(input: Record<string, unknown>): {
  reservationId?: string | null;
} {
  const value = input.reservationId;
  if (value == null || value === "") return { reservationId: null };
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error("Invalid reward reservation.");
  }
  return { reservationId: value };
}

export function assertNoCouponWithReward(
  couponCode: string | null | undefined,
  reservationId: string | null | undefined,
) {
  if (couponCode && reservationId) {
    throw new Error("A Burger Boost reward can't be combined with a coupon.");
  }
}

/** Stable fingerprint of the money-relevant request (prices excluded: server re-prices). */
export function requestFingerprint(input: {
  fulfillment: string;
  couponCode?: string | null | undefined;
  reservationId?: string | null | undefined;
  scheduledFor?: string | null | undefined;
  items: readonly {
    productId: string;
    variantId: string | null;
    quantity: number;
    comboKey?: string | null | undefined;
  }[];
}): string {
  const items = input.items
    .map((i) => `${i.productId}|${i.variantId ?? ""}|${i.quantity}|${i.comboKey ?? ""}`)
    .sort()
    .join(",");
  return [
    input.fulfillment,
    input.couponCode ?? "",
    input.reservationId ?? "",
    input.scheduledFor ?? "",
    items,
  ].join("#");
}

export type PlacedOrderRef = { id: string; code: string; createdAt: string };

type Entry = { fingerprint: string; promise: Promise<PlacedOrderRef> };

/**
 * In-memory idempotency ledger. Concurrent duplicates share the same
 * in-flight promise (one insert); later duplicates get the stored result;
 * the same key with a different payload is rejected; a failed attempt is
 * forgotten so the customer can retry.
 */
export class IdempotencyLedger {
  private entries = new Map<string, Entry>();
  constructor(private readonly max = 5000) {}

  run(
    scope: string,
    key: string,
    fingerprint: string,
    work: () => Promise<PlacedOrderRef>,
  ): Promise<PlacedOrderRef> {
    if (!IDEMPOTENCY_KEY_RE.test(key))
      return Promise.reject(new Error("Invalid order request id."));
    const id = `${scope}:${key}`;
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.reject(
          new Error("This order request was already used for a different order."),
        );
      }
      return existing.promise;
    }
    if (this.entries.size >= this.max) this.entries.clear();
    const promise = work();
    this.entries.set(id, { fingerprint, promise });
    promise.catch(() => {
      if (this.entries.get(id)?.promise === promise) this.entries.delete(id);
    });
    return promise;
  }
}

/**
 * Reward Mode gate for placeOrder. Always throws today: while the checkout
 * release lock is closed the reward path is blocked, and even once unlocked
 * the approved place_order_with_reward RPC must be installed first.
 */
export function assertRewardCheckoutAllowed(locks: { checkout: boolean } = RELEASE_LOCKS): never {
  if (!locks.checkout) throw new Error("Burger Boost rewards can't be used at checkout yet.");
  throw new Error("Burger Boost reward checkout isn't installed yet.");
}

// ---------------------------------------------------------------------------
// 23505 handling for order inserts. Postgres reports the violated constraint
// name/key in message/details; we classify on those instead of the bare code.
// ---------------------------------------------------------------------------
type PgErrorLike = { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown };

function pgText(err: unknown): string {
  const e = (err ?? {}) as PgErrorLike;
  return [e.message, e.details, e.constraint].filter((v) => typeof v === "string").join(" ");
}

export function isIdempotencyKeyConflict(err: unknown): boolean {
  if ((err as PgErrorLike | null)?.code !== "23505") return false;
  return /orders_idempotency_key_uq|\(idempotency_key\)/.test(pgText(err));
}

export function isOrderCodeConflict(err: unknown): boolean {
  if ((err as PgErrorLike | null)?.code !== "23505") return false;
  return /orders_code_key|\(code\)/.test(pgText(err));
}

export interface InsertedOrderRow {
  id: string;
  code: string;
  created_at: string;
}

export interface OrderInsertDeps {
  /** Inserts one order attempt with a fresh order code. */
  insert: () => Promise<{ data: InsertedOrderRow | null; error: unknown }>;
  /** Reads the committed order holding this idempotency key. */
  findByKey: (
    key: string,
  ) => Promise<{ data: (InsertedOrderRow & { user_id: string | null }) | null; error: unknown }>;
}

export type OrderInsertOutcome =
  | { kind: "inserted"; row: InsertedOrderRow }
  | { kind: "existing"; row: InsertedOrderRow }
  | { kind: "failed"; error: unknown };

/**
 * Inserts an order. Order-code collisions retry with a new code; an
 * idempotency-key collision returns the already-committed order (same user
 * only, never another user's); any other error fails visibly.
 */
export async function insertOrderIdempotent(
  deps: OrderInsertDeps,
  idempotencyKey: string | null | undefined,
  userId: string | null,
  maxAttempts = 3,
): Promise<OrderInsertOutcome> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await deps.insert();
    if (!error && data) return { kind: "inserted", row: data };
    lastError = error;
    if (idempotencyKey && isIdempotencyKeyConflict(error)) {
      const found = await deps.findByKey(idempotencyKey);
      if (found.error || !found.data) return { kind: "failed", error: found.error ?? error };
      if (!userId || found.data.user_id !== userId) {
        throw new Error("This order request id was already used. Please refresh and try again.");
      }
      const { id, code, created_at } = found.data;
      return { kind: "existing", row: { id, code, created_at } };
    }
    if (isOrderCodeConflict(error)) continue;
    break;
  }
  return { kind: "failed", error: lastError };
}
