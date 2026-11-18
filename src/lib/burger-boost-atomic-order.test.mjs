import { describe, expect, test } from "bun:test";
import { buildAtomicOrderArgs, callAtomicRewardOrder, expectedRewardTotals, mapAtomicOrderResult } from "./burger-boost-atomic-order.ts";
import { eligibleSubtotal, isEligibleLine } from "./burger-boost-eligibility.ts";

const L = (categorySlug, productSlug, unitPrice, quantity = 1, comboKey = null) => ({ categorySlug, productSlug, unitPrice, quantity, comboKey });
const header = { code: "FLM-1", channel: "online", status: "placed", order_kind: "regular", scheduled_for: null, scheduled_activate_at: null, fulfillment: "delivery", payment_method: "cod", payment_label: "Cash", customer_name: "A B", customer_phone: "01700000000", address_line: "x", area: null, landmark: null, delivery_notes: null, zone_id: null, zone_name: null, latitude: null, longitude: null, distance_m: null, estimated_time: null, pickup_note: null, delivery_charge: 60 };
const item = { product_id: "p", product_slug: "classic", product_name: "Classic", variant_id: null, variant_name: null, unit_price: 200, quantity: 1, image_url: null, combo_name: null, combo_key: null };
const KEY = "req_0123456789abcdef";

describe("Burger Boost atomic order contract", () => {
  test("shawarma eligible; nachos, wings, lollipop excluded", () => {
    expect(isEligibleLine(L("shawarma-and-sides", "chicken-shawarma", 99))).toBe(true);
    for (const s of ["nachos", "bbq-wings-4-pcs", "chicken-lollipop-6-pcs", undefined]) expect(isEligibleLine(L("shawarma-and-sides", s, 1))).toBe(false);
  });
  test("drinks, addons and combo lines excluded", () => {
    expect(eligibleSubtotal([L("drinks", "cola", 50), L("addons", "cheese", 30), L("burger", "c", 300, 1, "combo1"), L("pizza", "p", 280)])).toBe(280);
  });
  test("delivery fee never discounted", () => {
    const t = expectedRewardTotals([L("burger", "c", 300)], 20, 0, 60);
    expect(t).toMatchObject({ ok: true, subtotal: 300, discount: 60, deliveryCharge: 60, total: 300 });
  });
  test("minimum checked on eligible food only", () => {
    expect(expectedRewardTotals([L("burger", "c", 100), L("drinks", "x", 500)], 10, 300, 0)).toMatchObject({ ok: false, reason: "below_minimum" });
  });
  test("only excluded items -> no_eligible_items", () => {
    expect(expectedRewardTotals([L("shawarma-and-sides", "nachos", 110)], 10, 0, 0)).toMatchObject({ ok: false, reason: "no_eligible_items" });
  });
  test("client cannot send money/tier fields; coupons and guests refused", () => {
    expect(() => buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: KEY, header: { ...header, discount: 99 }, items: [item] })).toThrow();
    expect(() => buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: KEY, header, items: [item], couponCode: "X" })).toThrow();
    expect(() => buildAtomicOrderArgs({ userId: null, reservationId: "r", idempotencyKey: KEY, header, items: [item] })).toThrow();
    expect(() => buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: "short", header, items: [item] })).toThrow();
  });
  test("result mapping: expired, already redeemed, wrong owner, replay", () => {
    expect(mapAtomicOrderResult({ result: "reservation_unavailable" })).toMatchObject({ ok: false, code: "reservation_unavailable" });
    expect(mapAtomicOrderResult({ result: "reservation_not_found" })).toMatchObject({ ok: false });
    expect(mapAtomicOrderResult({ result: "idempotency_conflict" })).toMatchObject({ ok: false });
    expect(mapAtomicOrderResult({ result: "replayed", order_id: "o", order_code: "C", discount: 60, total: 300 })).toMatchObject({ ok: true, replayed: true });
  });
  test("release lock closed: RPC never called", async () => {
    let called = 0;
    const client = { rpc: async () => { called++; return { data: null, error: null }; } };
    const args = buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: KEY, header, items: [item] });
    expect(await callAtomicRewardOrder(client, args)).toMatchObject({ ok: false, code: "release_locked" });
    expect(called).toBe(0);
  });
  test("transaction contract: one RPC call with exact args when unlocked", async () => {
    const calls = [];
    const client = { rpc: async (fn, a) => { calls.push([fn, a]); return { data: { result: "placed", order_id: "o", order_code: "FLM-1", discount: 40, total: 260 }, error: null }; } };
    const args = buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: KEY, header, items: [item] });
    expect(await callAtomicRewardOrder(client, args, { checkout: true })).toMatchObject({ ok: true, orderId: "o" });
    expect(calls).toEqual([["place_order_with_reward", args]]);
  });
  test.todo("PENDING real DB: concurrent redemption / expiry / cancel-vs-kitchen / rollback");
});
