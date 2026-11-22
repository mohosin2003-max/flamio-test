import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  insertOrderIdempotent,
  isIdempotencyKeyConflict,
  isOrderCodeConflict,
  newCheckoutAttemptKey,
} from "./order-idempotency.ts";

const KEY = "ord-" + "k".repeat(32);
const idemErr = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "orders_idempotency_key_uq"',
  details: `Key (idempotency_key)=(${KEY}) already exists.`,
};
const codeErr = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "orders_code_key"',
  details: "Key (code)=(FLM-1) already exists.",
};
const otherErr = { code: "23505", message: 'violates "orders_other_key"', details: "Key (customer_phone)=(x)" };

/** Shared fake orders table enforcing unique code + idempotency_key, with side-effect counters. */
function fakeDb() {
  const rows = [];
  const items = [];
  const effects = { coupon: 0, stock: 0 };
  let n = 0;
  const deps = (userId, key) => ({
    insert: async () => {
      await Promise.resolve();
      const code = `C${++n}`;
      if (key && rows.some((r) => r.idempotency_key === key)) return { data: null, error: idemErr };
      const row = { id: `id-${rows.length + 1}`, code, created_at: "t", user_id: userId, idempotency_key: key };
      rows.push(row);
      return { data: { id: row.id, code, created_at: "t" }, error: null };
    },
    findByKey: async (k) => ({ data: rows.find((r) => r.idempotency_key === k) ?? null, error: null }),
  });
  // Mirrors placeOrder: side effects run only for a freshly inserted order.
  const place = async (userId, key) => {
    const out = await insertOrderIdempotent(deps(userId, key), key, userId);
    if (out.kind === "inserted") {
      items.push(out.row.id);
      effects.coupon++;
      effects.stock++;
    }
    return out;
  };
  return { rows, items, effects, place };
}

describe("normal checkout source wiring", () => {
  const checkout = readFileSync(new URL("../routes/checkout.tsx", import.meta.url), "utf8");
  const fn = readFileSync(new URL("./orders.functions.ts", import.meta.url), "utf8");
  test("A. checkout sends a stable attempt key and only renews it after success", () => {
    expect(checkout).toContain("idempotencyKey: orderAttemptKeyRef.current");
    expect(checkout).toContain("useRef(newCheckoutAttemptKey())");
    const renew = checkout.indexOf("orderAttemptKeyRef.current = newCheckoutAttemptKey()");
    const submit = checkout.indexOf("await submitOrder(");
    expect(renew).toBeGreaterThan(submit);
  });
  test("B. key is persisted to orders.idempotency_key", () => {
    expect(fn).toContain("idempotency_key: data.idempotencyKey ?? null");
    expect(fn).toContain("idempotencyKey: z.string().trim().min(8).max(128).nullable().optional()");
  });
  test("reward checkout keeps its own key", () => {
    expect(checkout).toContain("idempotencyKey: rewardIdempotencyKeyRef.current");
  });
});

describe("23505 classification", () => {
  test("idempotency vs order-code vs unrelated", () => {
    expect(isIdempotencyKeyConflict(idemErr)).toBe(true);
    expect(isOrderCodeConflict(idemErr)).toBe(false);
    expect(isOrderCodeConflict(codeErr)).toBe(true);
    expect(isIdempotencyKeyConflict(codeErr)).toBe(false);
    expect(isIdempotencyKeyConflict(otherErr)).toBe(false);
    expect(isOrderCodeConflict(otherErr)).toBe(false);
  });
});

describe("normal order idempotency", () => {
  test("C/D/E/H. same key returns the existing order with no repeated items or side effects", async () => {
    const db = fakeDb();
    const first = await db.place("u1", KEY);
    const again = await db.place("u1", KEY);
    expect(first.kind).toBe("inserted");
    expect(again).toEqual({ kind: "existing", row: first.row });
    expect(db.rows.length).toBe(1);
    expect(db.items.length).toBe(1);
    expect(db.effects).toEqual({ coupon: 1, stock: 1 });
  });

  test("F. a different key creates a new order", async () => {
    const db = fakeDb();
    await db.place("u1", KEY);
    await db.place("u1", newCheckoutAttemptKey());
    expect(db.rows.length).toBe(2);
  });

  test("new attempt keys are unique and pass the 8-128 length rule", () => {
    const a = newCheckoutAttemptKey();
    const b = newCheckoutAttemptKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(128);
  });

  test("G. order-code collision still retries with a new code", async () => {
    let calls = 0;
    const out = await insertOrderIdempotent(
      {
        insert: async () =>
          ++calls === 1 ? { data: null, error: codeErr } : { data: { id: "x", code: "C2", created_at: "t" }, error: null },
        findByKey: async () => {
          throw new Error("must not look up on code collision");
        },
      },
      KEY,
      "u1",
    );
    expect(calls).toBe(2);
    expect(out.kind).toBe("inserted");
  });

  test("unrelated 23505 fails without retry", async () => {
    let calls = 0;
    const out = await insertOrderIdempotent(
      { insert: async () => (calls++, { data: null, error: otherErr }), findByKey: async () => ({ data: null, error: null }) },
      KEY,
      "u1",
    );
    expect(calls).toBe(1);
    expect(out.kind).toBe("failed");
  });

  test("I. concurrent same-key requests produce one order", async () => {
    const db = fakeDb();
    const [a, b] = await Promise.all([db.place("u1", KEY), db.place("u1", KEY)]);
    expect(db.rows.length).toBe(1);
    expect(db.items.length).toBe(1);
    expect(a.row.id).toBe(b.row.id);
  });

  test("J. another user or a guest can never read back the order", async () => {
    const db = fakeDb();
    await db.place("u1", KEY);
    await expect(db.place("u2", KEY)).rejects.toThrow("already used");
    await expect(db.place(null, KEY)).rejects.toThrow("already used");
    expect(db.rows.length).toBe(1);
  });
});
