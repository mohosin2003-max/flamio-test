/**
 * FLAMIO Burger Boost — Step 66 Reward session service (server-only, injected I/O).
 *
 * Wraps the live TEST RPCs prepare_reward_session / acknowledge_reward_start /
 * complete_reward_session. The seed and session id are generated here (server);
 * the final meter sent to complete_reward_session comes ONLY from the server
 * replay of the persisted seed + persisted rules version. Client values for
 * score, meter, discount, seed or status are never read.
 *
 * Release locks stay on: awardedDiscountPercent is always 0 and no coupon is issued.
 */
import { replayDiscountMeter, OPERATION_RULES_VERSION, TIERED_RULES_VERSION } from "./burger-boost-rules";
import {
  assertServerEnvironment, canonicalTelemetry, generateSeed, int8StringToUnsigned, sha256Hex,
  GATE_COUNT, HARD_CUTOFF_MS, type BurgerBoostSessionRepository,
} from "./burger-boost-session-core";
import { RELEASE_LOCKS } from "./burger-boost-reward-flow";

assertServerEnvironment();

export type RewardRpcResult = { result?: unknown; [k: string]: unknown };

export interface BurgerBoostRewardTransport {
  prepare_reward_session(p: { p_id: string; p_user_id: string; p_seed: string }): Promise<RewardRpcResult>;
  acknowledge_reward_start(p: { p_id: string; p_user_id: string }): Promise<RewardRpcResult>;
  complete_reward_session(p: { p_id: string; p_user_id: string; p_final_meter: number; p_telemetry_hash: string }): Promise<RewardRpcResult>;
  claim_reward_reservation(p: { p_session_id: string; p_user_id: string }): Promise<RewardRpcResult>;
  get_active_reward(p: { p_user_id: string }): Promise<RewardRpcResult>;
  transition_session(p: { p_id: string; p_user_id: string; p_target_status: "expired" | "rejected" }): Promise<boolean>;
}

export const ACK_WINDOW_MS = 15_000;

export type PrepareResult =
  | { ok: true; sessionId: string; ackDeadlineAt: number }
  | { ok: false; reason: "attempt_used" | "unavailable" };

export type AckResult =
  | { ok: true; sessionId: string; rulesVersion: number; startedAt: number; expiresAt: number }
  | { ok: false; reason: "ack_expired" | "attempt_used" | "not_found" | "invalid_state" | "unavailable" };

export type RewardOutcome = "release_locked" | "loss" | "none" | "full" | "partial";
export type ClaimResult =
  | { ok: true; reservationId: string; tier: "full" | "partial"; discountPercent: 0; status: "reserved" | "existing"; expiresAt: number }
  | { ok: false; reason: "game_disabled" | "not_eligible" | "loss" | "quota_exhausted" | "unavailable" };
export type CompleteResult =
  | { ok: true; verifiedScore: number; finalMeter: number; outcome: RewardOutcome; awardedDiscountPercent: 0 }
  | { ok: false; status: "not_found" | "not_reward" | "expired" | "rejected" | "completed" | "unavailable"; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ts = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);
const OUTCOMES: ReadonlySet<string> = new Set(["release_locked", "loss", "none", "full", "partial"]);

export function createRewardService(deps: {
  transport: BurgerBoostRewardTransport;
  repo: Pick<BurgerBoostSessionRepository, "findForUser">;
  now: () => number;
  newId: () => string;
  seed?: () => string;
}) {
  const t = deps.transport;
  return {
    async prepare(userId: string): Promise<PrepareResult> {
      if (!UUID_RE.test(userId)) return { ok: false, reason: "unavailable" };
      const id = deps.newId();
      const seed = (deps.seed ?? generateSeed)();
      const r = await t.prepare_reward_session({ p_id: id, p_user_id: userId, p_seed: seed });
      if (r?.result === "attempt_already_used") return { ok: false, reason: "attempt_used" };
      if (r?.result !== "prepared" && r?.result !== "existing_prepared") return { ok: false, reason: "unavailable" };
      const sid = r.session_id;
      const deadline = ts(r.ack_deadline_at);
      const prepared = ts(r.prepared_at);
      if (typeof sid !== "string" || !UUID_RE.test(sid) || !Number.isFinite(deadline)) return { ok: false, reason: "unavailable" };
      if (Number.isFinite(prepared) && deadline !== prepared + ACK_WINDOW_MS) return { ok: false, reason: "unavailable" };
      if (r.result === "prepared" && sid.toLowerCase() !== id.toLowerCase()) return { ok: false, reason: "unavailable" };
      return { ok: true, sessionId: sid, ackDeadlineAt: deadline };
    },

    /** Server deadline is authoritative (enforced inside the RPC). Retries are idempotent. */
    async acknowledge(userId: string, sessionId: string): Promise<AckResult> {
      if (!UUID_RE.test(userId) || !UUID_RE.test(sessionId)) return { ok: false, reason: "not_found" };
      const r = await t.acknowledge_reward_start({ p_id: sessionId, p_user_id: userId });
      const res = r?.result;
      if (res === "ack_expired") return { ok: false, reason: "ack_expired" };
      if (res === "attempt_already_used") return { ok: false, reason: "attempt_used" };
      if (res === "not_found" || res === "not_reward") return { ok: false, reason: "not_found" };
      if (res === "invalid_state") return { ok: false, reason: "invalid_state" };
      if (res !== "started" && res !== "already_started") return { ok: false, reason: "unavailable" };
      // Re-read the persisted row through the strict parser; never trust the RPC echo alone.
      const rec = await deps.repo.findForUser(sessionId, userId);
      if (!rec || rec.mode !== "reward" || rec.status !== "in_progress") return { ok: false, reason: "invalid_state" };
      return { ok: true, sessionId: rec.id, rulesVersion: rec.rulesVersion, startedAt: rec.startedAt, expiresAt: rec.expiresAt };
    },

    /** True only for a started reward session the caller owns. */
    async isReward(userId: string, sessionId: string): Promise<boolean> {
      try { const rec = await deps.repo.findForUser(sessionId, userId); return rec?.mode === "reward"; }
      catch { return false; }
    },

    async claim(userId: string, sessionId: string): Promise<ClaimResult> {
      if (!UUID_RE.test(userId) || !UUID_RE.test(sessionId)) return { ok: false, reason: "not_eligible" };
      const r = await t.claim_reward_reservation({ p_session_id: sessionId, p_user_id: userId });
      const res = r?.result;
      if (res === "game_disabled") return { ok: false, reason: "game_disabled" };
      if (res === "not_eligible") return { ok: false, reason: "not_eligible" };
      if (res === "loss") return { ok: false, reason: "loss" };
      if (res === "quota_exhausted") return { ok: false, reason: "quota_exhausted" };
      if (res !== "reserved" && res !== "existing") return { ok: false, reason: "unavailable" };
      const id = r.id, tier = r.tier, expiresAt = ts(r.expires_at), pct = Number(r.discount_percent ?? 0);
      if (typeof id !== "string" || !UUID_RE.test(id) || (tier !== "full" && tier !== "partial") ||
          !Number.isInteger(pct) || pct < 0 || !Number.isFinite(expiresAt)) return { ok: false, reason: "unavailable" };
      if (!RELEASE_LOCKS.couponIssuance && pct !== 0) return { ok: false, reason: "unavailable" };
      return { ok: true, reservationId: id, tier, discountPercent: 0, status: res as "reserved" | "existing", expiresAt };
    },

    /** `payload` is untrusted; only playerActions is read. */
    async complete(userId: string, sessionId: string, payload: unknown): Promise<CompleteResult> {
      const rec = await deps.repo.findForUser(sessionId, userId);
      if (!rec) return { ok: false, status: "not_found", error: "session not found" };
      if (rec.mode !== "reward") return { ok: false, status: "not_reward", error: "not a reward session" };
      if (rec.status !== "in_progress") return { ok: false, status: rec.status === "completed" ? "completed" : "rejected", error: "session not in progress" };
      const now = deps.now();
      if (!Number.isFinite(now) || now < rec.startedAt || rec.expiresAt !== rec.startedAt + HARD_CUTOFF_MS) {
        return { ok: false, status: "unavailable", error: "clock anomaly" };
      }
      if (now > rec.expiresAt) {
        await t.transition_session({ p_id: sessionId, p_user_id: userId, p_target_status: "expired" });
        return { ok: false, status: "expired", error: "hard cutoff exceeded" };
      }
      const reject = async (error: string): Promise<CompleteResult> => {
        await t.transition_session({ p_id: sessionId, p_user_id: userId, p_target_status: "rejected" });
        return { ok: false, status: "rejected", error };
      };
      if (rec.rulesVersion !== OPERATION_RULES_VERSION && rec.rulesVersion !== TIERED_RULES_VERSION) return reject("unsupported rules version");
      const actions = payload && typeof payload === "object" ? (payload as { playerActions?: unknown }).playerActions : undefined;
      if (!Array.isArray(actions) || actions.length !== GATE_COUNT) return reject("invalid actions");
      let seed: bigint;
      try { seed = int8StringToUnsigned(rec.seed); } catch { return reject("invalid seed"); }
      const m = replayDiscountMeter(seed, GATE_COUNT, actions, rec.rulesVersion);
      if (!m.valid || m.gatesPassed !== GATE_COUNT) return reject("invalid replay");
      if (!Number.isSafeInteger(m.finalMeter) || Math.abs(m.finalMeter) > 2147483647) return reject("invalid score");
      const hash = await sha256Hex(canonicalTelemetry(actions as { gateIndex: number; lane: number; t: number }[]));
      const r = await t.complete_reward_session({ p_id: sessionId, p_user_id: userId, p_final_meter: m.finalMeter, p_telemetry_hash: hash });
      const res = r?.result;
      if (res === "expired") return { ok: false, status: "expired", error: "hard cutoff exceeded" };
      if (res === "not_eligible") return { ok: false, status: "completed", error: "session already finalized" };
      if (typeof res !== "string" || !OUTCOMES.has(res)) return { ok: false, status: "unavailable", error: "completion failed" };
      // Locks: the RPC never awards today; enforce 0 here too regardless of its echo.
      if (Number(r.awarded_discount_percent ?? 0) !== 0 && !RELEASE_LOCKS.couponIssuance) {
        return { ok: false, status: "unavailable", error: "lock violation" };
      }
      return { ok: true, verifiedScore: Math.max(0, m.finalMeter), finalMeter: m.finalMeter, outcome: res as RewardOutcome, awardedDiscountPercent: 0 };
    },
  };
}
export type RewardService = ReturnType<typeof createRewardService>;
