// Contract tests (mocked transport) for 23505 handling in order inserts.
import { describe, expect, test } from "bun:test";
import {
  insertOrderIdempotent,
  isIdempotencyKeyConflict,
  isOrderCodeConflict,
} from "./order-pricing.ts";

const KEY = "k".repeat(32);
const idemErr = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "orders_idempotency_key_uq"',
  details: `Key (idempotency_key)=(${KEY}) already exists.`,
};
const codeErr = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "orders_code_key"',
  details: "Key (code)=(FLM-261120-ABC) already exists.",
};
const otherErr = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "orders_something_else_key"',
  details: "Key (customer_phone)=(x) already exists.",
};

/** Fake orders table shared by "workers", enforcing unique code + key. */
function fakeDb() {
  const rows = [];
  let n = 0;
  const worker = (userId, codes) => ({
    insert: async () => {
      const code = codes.shift() ?? `C${++n}`;
      if (rows.some((r) => r.idempotency_key === KEY)) return { data: null, error: idemErr };
      if (rows.some((r) => r.code === code)) return { data: null, error: codeErr };
      const row = {
        id: `id-${rows.length + 1}`,
        code,
        created_at: "t",
        user_id: userId,
        idempotency_key: KEY,
      };
      rows.push(row);
      return { data: { id: row.id, code, created_at: "t" }, error: null };
    },
    findByKey: async (k) => ({
      data: rows.find((r) => r.idempotency_key === k) ?? null,
      error: null,
    }),
  });
  return { rows, worker };
}

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

describe("order insert 23505 handling", () => {
  test("same-user duplicate idempotency key returns the existing order", async () => {
    const db = fakeDb();
    const first = await insertOrderIdempotent(db.worker("u1", []), KEY, "u1");
    const again = await insertOrderIdempotent(db.worker("u1", []), KEY, "u1");
    expect(first.kind).toBe("inserted");
    expect(again).toEqual({ kind: "existing", row: first.row });
  });

  test("cross-worker concurrent duplicate creates only one order", async () => {
    const db = fakeDb();
    const [a, b] = await Promise.all([
      insertOrderIdempotent(db.worker("u1", []), KEY, "u1"),
      insertOrderIdempotent(db.worker("u1", []), KEY, "u1"),
    ]);
    expect(db.rows.length).toBe(1);
    expect(a.row.id).toBe(b.row.id);
    expect([a.kind, b.kind].sort()).toEqual(["existing", "inserted"]);
  });

  test("different user never receives another user's order", async () => {
    const db = fakeDb();
    await insertOrderIdempotent(db.worker("u1", []), KEY, "u1");
    await expect(insertOrderIdempotent(db.worker("u2", []), KEY, "u2")).rejects.toThrow(
      "already used",
    );
    await expect(insertOrderIdempotent(db.worker(null, []), KEY, null)).rejects.toThrow(
      "already used",
    );
    expect(db.rows.length).toBe(1);
  });

  test("genuine order-code collision retries with a new code", async () => {
    let calls = 0;
    const out = await insertOrderIdempotent(
      {
        insert: async () =>
          ++calls === 1
            ? { data: null, error: codeErr }
            : { data: { id: "x", code: "C2", created_at: "t" }, error: null },
        findByKey: async () => {
          throw new Error("must not look up on code collision");
        },
      },
      KEY,
      "u1",
    );
    expect(calls).toBe(2);
    expect(out).toEqual({ kind: "inserted", row: { id: "x", code: "C2", created_at: "t" } });
  });

  test("unrelated 23505 stays an error and is not retried", async () => {
    let calls = 0;
    const out = await insertOrderIdempotent(
      {
        insert: async () => (calls++, { data: null, error: otherErr }),
        findByKey: async () => ({ data: null, error: null }),
      },
      KEY,
      "u1",
    );
    expect(calls).toBe(1);
    expect(out).toEqual({ kind: "failed", error: otherErr });
  });
});
