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
  /** NULL only for a never-acknowledged Reward row (Step 58 two-phase start). */
  started_at: string | null;
  expires_at: string | null;
  completed_at: string | null;
  verified_score: number | null;
  telemetry_hash: string | null;
  awarded_discount_percent: string | number;
  rules_version: number;
  /** Step 58 columns; absent from the base read RPC ⇒ treated as legacy. */
  mode?: string;
  prepared_at?: string | null;
  ack_deadline_at?: string | null;
  ack_at?: string | null;
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

export type PersistenceErrorCode = "persistence_unavailable" | "invalid_input" | "conflict" | "invalid_row" | "not_started";

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
const ROW_STATUSES: ReadonlySet<string> = new Set(["prepared", "in_progress", "completed", "expired", "rejected"]);
const MODES: ReadonlySet<string> = new Set(["legacy", "practice", "reward"]);
const ACK_WINDOW_MS = 15_000;
const HARD_CUTOFF_MS = 75_000;

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

/**
 * Reward session that has no official start (Step 58 two-phase): status
 * "prepared", or "expired" without acknowledgement. started/expires stay null —
 * never replaced with placeholder times.
 */
export type UnstartedRewardRecord = {
  id: string;
  userId: string;
  seed: string;
  rulesVersion: number;
  mode: "reward";
  status: "prepared" | "expired";
  startedAt: null;
  expiresAt: null;
  preparedAt: number;
  ackDeadlineAt: number;
  ackAt: null;
};

export type ParsedSessionRow =
  | { kind: "started"; record: SessionRecord }
  | { kind: "unstarted"; record: UnstartedRewardRecord };

const bad = () => new BurgerBoostPersistenceError("invalid_row");

/** Strict parser for every valid row shape. Throws invalid_row on anything else. */
export function parseSessionRow(row: RpcSessionRow): ParsedSessionRow {
  if (!row || !ROW_STATUSES.has(row.status)) throw bad();
  if (Number(row.awarded_discount_percent) !== 0) throw bad();
  const mode = row.mode ?? "legacy";
  if (!MODES.has(mode)) throw bad();
  // Step 64K: legacy <=> v1 only; practice/reward rows carry v2 or v3.
  if (mode === "legacy" ? row.rules_version !== 1 : row.rules_version !== 2 && row.rules_version !== 3) throw bad();
  const completedAt = nullableTs(row.completed_at ?? null);
  const verifiedScore = row.verified_score ?? null;
  const telemetryHash = row.telemetry_hash ?? null;
  const done = row.status === "completed";
  const fields = [completedAt, verifiedScore, telemetryHash];
  if (done ? fields.some((f) => f === null) : fields.some((f) => f !== null)) throw bad();

  const preparedAt = nullableTs(row.prepared_at ?? null);
  const ackDeadlineAt = nullableTs(row.ack_deadline_at ?? null);
  const ackAt = nullableTs(row.ack_at ?? null);
  if (mode === "reward") {
    if (preparedAt === null || ackDeadlineAt !== preparedAt + ACK_WINDOW_MS) throw bad();
  } else if (preparedAt !== null || ackDeadlineAt !== null || ackAt !== null) {
    throw bad();
  }

  const unstarted = row.started_at === null || row.started_at === undefined;
  if (unstarted) {
    if (row.expires_at !== null && row.expires_at !== undefined) throw bad();
    if (mode !== "reward" || ackAt !== null) throw bad();
    if (row.status !== "prepared" && row.status !== "expired") throw bad();
    return {
      kind: "unstarted",
      record: {
        id: row.id, userId: row.user_id, seed: normalizeInt8(row.seed), rulesVersion: row.rules_version,
        mode: "reward", status: row.status, startedAt: null, expiresAt: null,
        preparedAt: preparedAt!, ackDeadlineAt: ackDeadlineAt!, ackAt: null,
      },
    };
  }
  // Official start exists: both timestamps required and valid.
  if (row.status === "prepared") throw bad();
  const startedAt = timestamptzToMs(row.started_at as string);
  if (row.expires_at === null || row.expires_at === undefined) throw bad();
  const expiresAt = timestamptzToMs(row.expires_at);
  if (expiresAt !== startedAt + HARD_CUTOFF_MS) throw bad();
  if (mode === "reward" && (ackAt === null || ackAt !== startedAt || ackAt > ackDeadlineAt!)) throw bad();
  if (!STATUSES.has(row.status)) throw bad();
  const rec: SessionRecord = {
    id: row.id,
    userId: row.user_id,
    seed: normalizeInt8(row.seed),
    rulesVersion: row.rules_version,
    status: row.status as SessionStatus,
    startedAt,
    expiresAt,
    completedAt,
    verifiedScore,
    telemetryHash,
    awardedDiscountPercent: 0,
    ...(mode === "practice" || mode === "reward" ? { mode } : {}),
  };
  return { kind: "started", record: rec };
}

/**
 * Started-session mapper used by the core. A valid unstarted Reward row is not
 * a playable session: it fails closed with "not_started" (never invalid_row,
 * never fake timestamps).
 */
export function rowToRecord(row: RpcSessionRow): SessionRecord {
  const parsed = parseSessionRow(row);
  if (parsed.kind !== "started") throw new BurgerBoostPersistenceError("not_started");
  return parsed.record;
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

/* -------------------- Supabase RPC transport (STEP 04K) -------------------- */

export type SupabaseRpcResponse<T> = {
  data: T | null;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
};

/** Minimal structural client: only `.schema(...)` is required. */
export interface SupabaseSchemaClient {
  schema(name: string): {
    rpc(fn: string, args?: Record<string, unknown>): PromiseLike<SupabaseRpcResponse<unknown>>;
  };
}

const BB_SCHEMA = "burger_boost";

/**
 * Real transport. Every RPC is dispatched via `supabase.schema("burger_boost").rpc(...)`;
 * there is no base-schema fallback. Errors are rethrown for `mapPersistenceError`.
 */
export function createSupabaseBurgerBoostTransport(supabase: SupabaseSchemaClient): BurgerBoostRpcTransport & { callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> } {
  if (!supabase || typeof supabase.schema !== "function") {
    throw new BurgerBoostPersistenceError("persistence_unavailable");
  }
  async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await supabase.schema(BB_SCHEMA).rpc(fn, args);
    if (error) throw error;
    return data;
  }
  function strictBool(v: unknown): boolean {
    if (typeof v !== "boolean") throw new BurgerBoostPersistenceError("persistence_unavailable");
    return v;
  }
  return {
    async create_session(p) {
      const d = await rpc("create_session", p);
      if (typeof d !== "string") throw new BurgerBoostPersistenceError("persistence_unavailable");
      return d;
    },
    async get_session_for_user(p) {
      const d = await rpc("get_session_for_user", p);
      if (d === null) return [];
      if (!Array.isArray(d)) throw new BurgerBoostPersistenceError("invalid_row");
      return d as RpcSessionRow[];
    },
    async complete_session(p) { return strictBool(await rpc("complete_session", p)); },
    async transition_session(p) { return strictBool(await rpc("transition_session", p)); },
    /** Step 66: shared single call site, reused by the reward transport. */
    callRpc: rpc,
  };
}

/** Step 66: live TEST reward RPCs (jsonb results). Any non-object result fails closed. */
export function createSupabaseRewardTransport(supabase: SupabaseSchemaClient) {
  const base = createSupabaseBurgerBoostTransport(supabase);
  async function obj(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const data = await base.callRpc(fn, args);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new BurgerBoostPersistenceError("persistence_unavailable");
      return data as Record<string, unknown>;
    } catch (e) { throw mapPersistenceError(e); }
  }
  return {
    prepare_reward_session: (p: { p_id: string; p_user_id: string; p_seed: string }) =>
      obj("prepare_reward_session", { ...p, p_seed: normalizeInt8(p.p_seed) }),
    acknowledge_reward_start: (p: { p_id: string; p_user_id: string }) => obj("acknowledge_reward_start", p),
    complete_reward_session: (p: { p_id: string; p_user_id: string; p_final_meter: number; p_telemetry_hash: string }) =>
      obj("complete_reward_session", p),
    claim_reward_reservation: (p: { p_session_id: string; p_user_id: string }) =>
      obj("claim_reward_reservation", p),
    get_active_reward: (p: { p_user_id: string }) =>
      obj("get_active_reward", p),
    transition_session: base.transition_session,
  };
}
