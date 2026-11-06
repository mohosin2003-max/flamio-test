/**
 * FLAMIO Burger Boost — server session adapter (STEP 04G).
 *
 * SERVER-ONLY (`.server.ts`). Maps the core `BurgerBoostSessionRepository`
 * onto the four approved `burger_boost.*` RPC contracts through an INJECTED
 * transport. This module creates no DB client and invokes no real RPC.
 * The RPCs are NOT deployed; only mock transports are used today.
 *
 * - int8 seed travels as an exact decimal string (never JS Number).
 * - epoch ms <-> ISO-8601 UTC timestamptz.
 * - errors are mapped to a fixed, internals-free code set.
 * - userId must come from a trusted server-side identity (never client input).
 */
import {
  assertServerEnvironment,
  int8StringToUnsigned,
  type BurgerBoostSessionRepository,
  type CompletionUpdate,
  type SessionRecord,
  type SessionStatus,
} from "./burger-boost-session-core";

assertServerEnvironment();

export type RpcSessionRow = {
  id: string;
  user_id: string;
  idempotency_key: string;
  status: string;
  seed: string | number | bigint;
  started_at: string;
  expires_at: string;
  completed_at: string | null;
  verified_score: number | null;
  telemetry_hash: string | null;
  awarded_discount_percent: string | number;
  rules_version: number;
};

/** Transport for the four approved RPCs. Implementations must pass int8 as string. */
export interface BurgerBoostRpcTransport {
  create_session(p: {
    p_id: string; p_user_id: string; p_seed: string; p_rules_version: number;
    p_idempotency_key: string; p_started_at: string; p_expires_at: string;
  }): Promise<string>;
  get_session_for_user(p: { p_id: string; p_user_id: string }): Promise<RpcSessionRow[]>;
  complete_session(p: {
    p_id: string; p_user_id: string; p_verified_score: number;
    p_telemetry_hash: string; p_completed_at: string;
  }): Promise<boolean>;
  transition_session(p: { p_id: string; p_user_id: string; p_target_status: "expired" | "rejected" }): Promise<boolean>;
}

export type PersistenceErrorCode = "persistence_unavailable" | "invalid_input" | "conflict" | "invalid_row";

export class BurgerBoostPersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  constructor(code: PersistenceErrorCode) {
    super(`burger boost persistence error: ${code}`);
    this.name = "BurgerBoostPersistenceError";
    this.code = code;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH_RE = /^[0-9a-f]{64}$/;
const STATUSES: ReadonlySet<string> = new Set(["in_progress", "completed", "expired", "rejected"]);

/** Maps any transport error to a sanitized code. Never forwards message/details/hint. */
export function mapPersistenceError(err: unknown): BurgerBoostPersistenceError {
  if (err instanceof BurgerBoostPersistenceError) return err;
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "22023") return new BurgerBoostPersistenceError("invalid_input");
  if (code === "P0001" || code === "23505") return new BurgerBoostPersistenceError("conflict");
  return new BurgerBoostPersistenceError("persistence_unavailable");
}

export function msToTimestamptz(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new BurgerBoostPersistenceError("invalid_input");
  return new Date(ms).toISOString();
}

export function timestamptzToMs(v: string): number {
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  if (!Number.isFinite(ms)) throw new BurgerBoostPersistenceError("invalid_row");
  return ms;
}

function nullableTs(v: string | null): number | null {
  return v === null || v === undefined ? null : timestamptzToMs(v);
}

/** Exact int8 normalization. Rejects JS numbers (precision may already be lost). */
export function normalizeInt8(v: unknown): string {
  let s: string;
  if (typeof v === "bigint") s = v.toString();
  else if (typeof v === "string") s = v;
  else throw new BurgerBoostPersistenceError("invalid_row");
  try { int8StringToUnsigned(s); } catch { throw new BurgerBoostPersistenceError("invalid_row"); }
  return BigInt(s).toString();
}

function requireUuid(v: string): void {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new BurgerBoostPersistenceError("invalid_input");
}

export function rowToRecord(row: RpcSessionRow): SessionRecord {
  if (!row || !STATUSES.has(row.status)) throw new BurgerBoostPersistenceError("invalid_row");
  if (Number(row.awarded_discount_percent) !== 0) throw new BurgerBoostPersistenceError("invalid_row");
  const rec: SessionRecord = {
    id: row.id,
    userId: row.user_id,
    seed: normalizeInt8(row.seed),
    rulesVersion: row.rules_version,
    status: row.status as SessionStatus,
    startedAt: timestamptzToMs(row.started_at),
    expiresAt: timestamptzToMs(row.expires_at),
    completedAt: nullableTs(row.completed_at),
    verifiedScore: row.verified_score ?? null,
    telemetryHash: row.telemetry_hash ?? null,
    awardedDiscountPercent: 0,
  };
  const done = rec.status === "completed";
  const fields = [rec.completedAt, rec.verifiedScore, rec.telemetryHash];
  if (done ? fields.some((f) => f === null) : fields.some((f) => f !== null)) {
    throw new BurgerBoostPersistenceError("invalid_row");
  }
  return rec;
}

/**
 * Repository over the RPC transport. `idempotencyKey` defaults to the record id.
 * The core-generated `record.id` is authoritative: it is sent as `p_id` and the
 * returned id must match exactly, otherwise the insert fails closed.
 */
export function createBurgerBoostSessionRepository(deps: {
  transport: BurgerBoostRpcTransport;
  idempotencyKey?: (record: SessionRecord) => string;
}): BurgerBoostSessionRepository {
  const t = deps.transport;
  const keyOf = deps.idempotencyKey ?? ((r: SessionRecord) => r.id);
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) { throw mapPersistenceError(e); }
  }
  return {
    async insert(record) {
      requireUuid(record.userId); requireUuid(record.id);
      const params = {
        p_id: record.id,
        p_user_id: record.userId,
        p_seed: normalizeInt8(record.seed),
        p_rules_version: record.rulesVersion,
        p_idempotency_key: keyOf(record),
        p_started_at: msToTimestamptz(record.startedAt),
        p_expires_at: msToTimestamptz(record.expiresAt),
      };
      const id = await call(() => t.create_session(params));
      if (typeof id !== "string" || id.toLowerCase() !== record.id.toLowerCase()) {
        throw new BurgerBoostPersistenceError("conflict");
      }
    },
    async findForUser(id, userId) {
      if (!UUID_RE.test(id ?? "") ) return null;
      requireUuid(userId);
      const rows = await call(() => t.get_session_for_user({ p_id: id, p_user_id: userId }));
      if (!Array.isArray(rows) || rows.length === 0) return null;
      if (rows.length > 1) throw new BurgerBoostPersistenceError("invalid_row");
      const rec = rowToRecord(rows[0]!);
      if (rec.id !== id || rec.userId !== userId) throw new BurgerBoostPersistenceError("invalid_row");
      return rec;
    },
    async completeIfInProgress(id, userId, u: CompletionUpdate) {
      requireUuid(id); requireUuid(userId);
      if (!Number.isSafeInteger(u.verifiedScore) || u.verifiedScore < 0 || u.verifiedScore > 2147483647
          || !HASH_RE.test(u.telemetryHash)) throw new BurgerBoostPersistenceError("invalid_input");
      const r = await call(() => t.complete_session({
        p_id: id, p_user_id: userId, p_verified_score: u.verifiedScore,
        p_telemetry_hash: u.telemetryHash, p_completed_at: msToTimestamptz(u.completedAt),
      }));
      return r === true;
    },
    async transitionIfInProgress(id, userId, status) {
      requireUuid(id); requireUuid(userId);
      if (status !== "expired" && status !== "rejected") throw new BurgerBoostPersistenceError("invalid_input");
      const r = await call(() => t.transition_session({ p_id: id, p_user_id: userId, p_target_status: status }));
      return r === true;
    },
  };
}
