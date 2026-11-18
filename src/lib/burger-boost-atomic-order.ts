/**
 * FLAMIO Burger Boost — atomic order + reward contract (PURE, inactive).
 *
 * Prepares the arguments for burger_boost.place_order_with_reward (SQL draft
 * docs/burger-boost/drafts/20261118010000_*_atomic_order_DRAFT.sql) and maps
 * its result. The database function, not this module, is the transaction:
 * it inserts order + items, prices the discount from persisted rows,
 * redeems the reservation and moves the counter in ONE transaction.
 *
 * NOT wired into placeOrder: the RPC does not exist in any database yet and
 * RELEASE_LOCKS.checkout is false. callAtomicRewardOrder refuses while locked.
 * The browser never supplies discount, percent, tier, limit or eligible subtotal.
 */
import { RELEASE_LOCKS } from "./burger-boost-reward-flow";
import { rewardDiscount, type TrustedLine } from "./burger-boost-eligibility";

export const ATOMIC_ORDER_RPC = "place_order_with_reward" as const;

export type AtomicOrderItem = {
  product_id: string;
  product_slug: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  unit_price: number;
  quantity: number;
  image_url: string | null;
  combo_name: string | null;
  combo_key: string | null;
};

/** Order fields already computed and validated by placeOrder on the server. */
export type AtomicOrderHeader = {
  code: string;
  channel: "online";
  status: "placed" | "scheduled";
  order_kind: "regular" | "scheduled";
  scheduled_for: string | null;
  scheduled_activate_at: string | null;
  fulfillment: "delivery" | "pickup";
  payment_method: string;
  payment_label: string;
  customer_name: string;
  customer_phone: string;
  address_line: string | null;
  area: string | null;
  landmark: string | null;
  delivery_notes: string | null;
  zone_id: string | null;
  zone_name: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_m: number | null;
  estimated_time: string | null;
  pickup_note: string | null;
  delivery_charge: number;
};

export type AtomicOrderArgs = {
  p_user_id: string;
  p_reservation_id: string;
  p_idempotency_key: string;
  p_order: AtomicOrderHeader;
  p_items: AtomicOrderItem[];
};

const FORBIDDEN_KEYS = [
  "discount",
  "subtotal",
  "total",
  "coupon_code",
  "discount_percent",
  "tier",
  "eligible_subtotal",
  "owner_max_discount",
];

export function buildAtomicOrderArgs(input: {
  userId: string | null;
  reservationId: string;
  idempotencyKey: string;
  header: AtomicOrderHeader;
  items: AtomicOrderItem[];
  couponCode?: string | null;
}): AtomicOrderArgs {
  if (!input.userId) throw new Error("Please sign in to use your Burger Boost reward.");
  if (input.couponCode) throw new Error("A Burger Boost reward can't be combined with a coupon.");
  if (input.header.channel !== "online")
    throw new Error("Burger Boost rewards apply to online orders only.");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.idempotencyKey))
    throw new Error("Invalid order request id.");
  if (input.items.length < 1 || input.items.length > 50) throw new Error("Your cart is empty.");
  for (const k of FORBIDDEN_KEYS)
    if (k in (input.header as Record<string, unknown>))
      throw new Error(`Field ${k} is server-derived.`);
  return {
    p_user_id: input.userId,
    p_reservation_id: input.reservationId,
    p_idempotency_key: input.idempotencyKey,
    p_order: { ...input.header },
    p_items: input.items.map((i) => ({ ...i })),
  };
}

/** Mirror of the SQL money formula (for tests/preview only; SQL is authoritative). */
export function expectedRewardTotals(
  lines: readonly TrustedLine[],
  percent: number,
  minOrderBdt: number,
  deliveryCharge: number,
) {
  const subtotal = Math.round(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0) * 100) / 100;
  const r = rewardDiscount(lines, percent, minOrderBdt);
  if (!r.ok) return { ok: false as const, reason: r.reason, subtotal };
  return {
    ok: true as const,
    subtotal,
    eligibleSubtotal: r.eligibleSubtotal,
    discount: r.discount,
    deliveryCharge,
    total: subtotal - r.discount + deliveryCharge,
  };
}

export type AtomicOrderResult =
  | { ok: true; orderId: string; code: string; discount: number; total: number; replayed: boolean }
  | { ok: false; code: string; message: string };

const MESSAGES: Record<string, string> = {
  reservation_not_found: "We couldn't find that Burger Boost reward.",
  reservation_unavailable: "This Burger Boost reward has expired or was already used.",
  below_minimum: "Add more eligible food to reach the reward's minimum order.",
  no_eligible_items: "Your cart has no food items this reward can discount.",
  idempotency_conflict: "This order request was already used for a different order.",
  release_locked: "Burger Boost rewards can't be used at checkout yet.",
};

export function mapAtomicOrderResult(raw: unknown): AtomicOrderResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const result = String(r.result ?? "");
  if ((result === "placed" || result === "replayed") && typeof r.order_id === "string") {
    return {
      ok: true,
      orderId: r.order_id,
      code: String(r.order_code),
      discount: Number(r.discount),
      total: Number(r.total),
      replayed: result === "replayed",
    };
  }
  return {
    ok: false,
    code: result || "unknown",
    message: MESSAGES[result] ?? "We couldn't place your order. Please try again.",
  };
}

type RpcClient = {
  rpc: (
    fn: string,
    args: AtomicOrderArgs,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/** Server-only call site. Refuses while the checkout release lock is closed. */
export async function callAtomicRewardOrder(
  client: RpcClient,
  args: AtomicOrderArgs,
  locks: { checkout: boolean } = RELEASE_LOCKS,
): Promise<AtomicOrderResult> {
  if (!locks.checkout)
    return { ok: false, code: "release_locked", message: MESSAGES.release_locked as string };
  const { data, error } = await client.rpc(ATOMIC_ORDER_RPC, args);
  if (error)
    return {
      ok: false,
      code: error.code ?? "rpc_error",
      message: "We couldn't place your order. Please try again.",
    };
  return mapAtomicOrderResult(data);
}
