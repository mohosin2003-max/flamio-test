// Step 4B — CONTRACT tests (pure/mocked). None of these touch PostgreSQL;
// real database concurrency remains unverified until the SQL draft is applied.
import { describe, expect, test } from "bun:test";
import {
  applyAuthoritativePrices, assertNoCouponWithReward, assertRewardCheckoutAllowed, IdempotencyLedger, requestFingerprint,
} from "./order-pricing.ts";
import { RELEASE_LOCKS } from "./burger-boost-reward-flow.ts";
import { callAtomicRewardOrder, buildAtomicOrderArgs, mapAtomicOrderResult } from "./burger-boost-atomic-order.ts";
import { rewardDiscount } from "./burger-boost-eligibility.ts";

const products = [{ id: "p1", base_price: 450, is_available: true }, { id: "p2", base_price: "300", is_available: true }];
const variants = [{ id: "v1", product_id: "p1", name: "Double", price: 620, is_available: true }];
const line = (o) => ({ productId: "p1", productName: "Burger", variantId: null, variantName: null, unitPrice: 1, comboKey: null, ...o });
const key = "a".repeat(32);
const ref = (id) => ({ id, code: "FLM-" + id, createdAt: "t" });

describe("server price authority [contract]", () => {
  test("tampered unitPrice is replaced by base_price", () => {
    expect(applyAuthoritativePrices([line({ unitPrice: 1 })], products, variants)[0].unitPrice).toBe(450);
  });
  test("variant price wins and must belong to product", () => {
    expect(applyAuthoritativePrices([line({ variantId: "v1", unitPrice: 5 })], products, variants)[0].unitPrice).toBe(620);
    expect(() => applyAuthoritativePrices([line({ productId: "p2", variantId: "v1" })], products, variants)).toThrow();
  });
  test("unknown or unavailable product rejected", () => {
    expect(() => applyAuthoritativePrices([line({ productId: "x" })], products, variants)).toThrow();
    expect(() => applyAuthoritativePrices([line()], [{ id: "p1", base_price: 1, is_available: false }], [])).toThrow();
  });
  test("normal checkout regression: honest cart keeps same prices; combos untouched", () => {
    const out = applyAuthoritativePrices([line({ unitPrice: 450 }), line({ productId: "p2", unitPrice: 300 }), line({ comboKey: "c", unitPrice: 999 })], products, variants);
    expect(out.map((l) => l.unitPrice)).toEqual([450, 300, 999]);
  });
});

describe("delivery fee isolation", () => {
  test("delivery charge is never in the discountable subtotal", () => {
    const r = rewardDiscount([{ categorySlug: "burger", unitPrice: 500, quantity: 1 }], 10, 0);
    expect(r.ok && r.eligibleSubtotal).toBe(500);
    expect(r.ok && r.discount).toBe(50);
  });
});

describe("idempotency [contract, in-memory]", () => {
  test("duplicate request returns the original order", async () => {
    const L = new IdempotencyLedger(); let n = 0;
    const work = async () => ref(String(++n));
    const a = await L.run("u", key, "f", work); const b = await L.run("u", key, "f", work);
    expect(b).toEqual(a); expect(n).toBe(1);
  });
  test("concurrent duplicates share one insert", async () => {
    const L = new IdempotencyLedger(); let n = 0;
    const work = () => new Promise((r) => setTimeout(() => r(ref(String(++n))), 5));
    const [a, b] = await Promise.all([L.run("u", key, "f", work), L.run("u", key, "f", work)]);
    expect(a).toBe(b); expect(n).toBe(1);
  });
  test("same key, different cart → conflict", async () => {
    const L = new IdempotencyLedger(); await L.run("u", key, "f1", async () => ref("1"));
    await expect(L.run("u", key, "f2", async () => ref("2"))).rejects.toThrow("different order");
  });
  test("failed attempt can be retried; other users isolated", async () => {
    const L = new IdempotencyLedger();
    await expect(L.run("u", key, "f", async () => { throw new Error("x"); })).rejects.toThrow();
    await Promise.resolve();
    expect((await L.run("u", key, "f", async () => ref("9"))).id).toBe("9");
    expect((await L.run("other", key, "f", async () => ref("7"))).id).toBe("7");
  });
  test("bad key rejected; fingerprint ignores prices/order", async () => {
    await expect(new IdempotencyLedger().run("u", "short", "f", async () => ref("1"))).rejects.toThrow();
    const it = (q) => ({ productId: "p", variantId: null, quantity: q });
    expect(requestFingerprint({ fulfillment: "pickup", items: [it(1), it(2)] })).toBe(requestFingerprint({ fulfillment: "pickup", items: [it(2), it(1)] }));
  });
});

describe("reward security [contract]", () => {
  test("coupon + reward rejected", () => {
    expect(() => assertNoCouponWithReward("SAVE10", "11111111-1111-1111-1111-111111111111")).toThrow("coupon");
    expect(() => assertNoCouponWithReward("SAVE10", null)).not.toThrow();
  });
  test("reward checkout blocked while RELEASE_LOCKS.checkout=false", async () => {
    expect(RELEASE_LOCKS.checkout).toBe(false);
    let called = false;
    const r = await callAtomicRewardOrder({ rpc: async () => { called = true; return { data: null, error: null }; } }, {});
    expect(r).toMatchObject({ ok: false, code: "release_locked" }); expect(called).toBe(false);
  });
  test("placeOrder reward gate refuses while locked", () => {
    expect(() => assertRewardCheckoutAllowed()).toThrow("can't be used at checkout yet");
  });
  test("forged discount fields rejected by arg builder", () => {
    expect(() => buildAtomicOrderArgs({ userId: "u", reservationId: "r", idempotencyKey: key, header: { channel: "online", discount: 99 }, items: [{}] })).toThrow("server-derived");
  });
  test("expired / replayed / foreign / duplicate reservation map to refusal", () => {
    // SQL raises reservation_not_found for another user's id (ownership filter).
    for (const c of ["reservation_unavailable", "reservation_not_found", "idempotency_conflict"])
      expect(mapAtomicOrderResult({ result: c }).ok).toBe(false);
    expect(mapAtomicOrderResult({ result: "replayed", order_id: "o", order_code: "c", discount: 1, total: 2 })).toMatchObject({ ok: true, replayed: true });
  });
  test("standard checkout unaffected without reservation", () => {
    expect(() => assertNoCouponWithReward(null, null)).not.toThrow();
  });
});
