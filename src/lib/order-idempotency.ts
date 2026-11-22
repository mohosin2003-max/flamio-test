/**
 * Normal-checkout idempotency (pure, no I/O). The database unique index on
 * orders.idempotency_key is the final duplicate guard; this module only
 * classifies 23505 errors and reads back the committed winner.
 */
type PgErrorLike = { code?: unknown; message?: unknown; details?: unknown; constraint?: unknown };

function pgText(err: unknown): string {
  const e = (err ?? {}) as PgErrorLike;
  return [e.message, e.details, e.constraint].filter((v) => typeof v === "string").join(" ");
}

export function isIdempotencyKeyConflict(err: unknown): boolean {
  if ((err as PgErrorLike | null)?.code !== "23505") return false;
  return /idempotency_key/.test(pgText(err));
}

export function isOrderCodeConflict(err: unknown): boolean {
  if ((err as PgErrorLike | null)?.code !== "23505") return false;
  return /orders_code_key|\(code\)/.test(pgText(err));
}

export type InsertedOrderRow = { id: string; code: string; created_at: string };
export type StoredOrderRow = InsertedOrderRow & { user_id: string | null };

export interface OrderInsertDeps {
  /** One insert attempt; generates a fresh order code each call. */
  insert: () => Promise<{ data: InsertedOrderRow | null; error: unknown }>;
  /** Reads the committed order holding this idempotency key. */
  findByKey: (key: string) => Promise<{ data: StoredOrderRow | null; error: unknown }>;
}

export type OrderInsertOutcome =
  | { kind: "inserted"; row: InsertedOrderRow }
  | { kind: "existing"; row: InsertedOrderRow }
  | { kind: "failed"; error: unknown };

function ownedRow(found: StoredOrderRow, userId: string | null): InsertedOrderRow {
  if (!userId || found.user_id !== userId) {
    throw new Error("This order request was already used. Please refresh and try again.");
  }
  return { id: found.id, code: found.code, created_at: found.created_at };
}

/**
 * Inserts an order. Order-code collisions retry with a new code; an
 * idempotency-key collision returns the already-committed order of the same
 * signed-in user (never anyone else's); every other error fails.
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
      return { kind: "existing", row: ownedRow(found.data, userId) };
    }
    if (isOrderCodeConflict(error)) continue;
    break;
  }
  return { kind: "failed", error: lastError };
}

export function newCheckoutAttemptKey(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `ord-${rand}`;
}
