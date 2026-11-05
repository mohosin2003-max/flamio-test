/**
 * FLAMIO Burger Boost — database-independent server session core (STEP 04C).
 *
 * SERVER-ONLY domain logic. No Supabase client, no DB driver, no SQL, no
 * network. Persistence is an injected `BurgerBoostSessionRepository`; this
 * module ships NO real adapter. The clock is injected; client timestamps are
 * untrusted telemetry and never prove elapsed time.
 *
 * Score weights (rules engine) remain PROVISIONAL. awardedDiscountPercent is
 * always 0. No coupon / checkout logic. Game remains disabled.
 */
import { simulateBurgerBoostReplay } from "./burger-boost-rules";

/**
 * Runtime server-only guard. NOTE: this is NOT compile-time enforcement
 * (no `.server.ts` naming); it only fails closed if evaluated in a browser.
 */
export function assertServerEnvironment(): void {
  if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
    throw new Error("burger-boost-session-core is server-only and must not run in a browser");
  }
}
assertServerEnvironment();

export const RULES_VERSION = 1;
export const GATE_COUNT = 30;
export const GAMEPLAY_WINDOW_MS = 60_000;
export const GRACE_PERIOD_MS = 15_000;
export const HARD_CUTOFF_MS = 75_000;

export type SessionStatus = "in_progress" | "completed" | "expired" | "rejected";

/** Server-side record. Never returned to the client as-is. */
export type SessionRecord = {
  id: string;
  userId: string;
  /** Signed int8 as a decimal string (exact; never a JS Number). */
  seed: string;
  rulesVersion: number;
  status: SessionStatus;
  startedAt: number; // epoch ms, server clock
  expiresAt: number; // startedAt + HARD_CUTOFF_MS
  completedAt: number | null;
  verifiedScore: number | null;
  telemetryHash: string | null;
  awardedDiscountPercent: 0;
};

export type CompletionUpdate = { verifiedScore: number; telemetryHash: string; completedAt: number };

/** Every mutating method MUST be an atomic conditional update on id + userId + status='in_progress'. */
export interface BurgerBoostSessionRepository {
  insert(record: SessionRecord): Promise<void>;
  findForUser(id: string, userId: string): Promise<SessionRecord | null>;
  completeIfInProgress(id: string, userId: string, update: CompletionUpdate): Promise<boolean>;
  /** Sets status only. MUST NOT set completedAt, verifiedScore or telemetryHash. */
  transitionIfInProgress(id: string, userId: string, status: "expired" | "rejected"): Promise<boolean>;
}

/** Client-safe view: no seed, track, answers, verified score or discount. */
export type SessionDTO = {
  sessionId: string;
  rulesVersion: number;
  gateCount: number;
  status: SessionStatus;
  startedAt: number;
  gameplayEndsAt: number;
  expiresAt: number;
};

export type SubmitResult =
  | { ok: true; status: "completed" }
  | { ok: false; status: SessionStatus | "not_found" | "clock_anomaly"; error: string };

// ---------- Seed ----------
export function generateSeed(): string {
  const buf = new BigUint64Array(1);
  globalThis.crypto.getRandomValues(buf);
  return unsignedToInt8String(buf[0] as bigint);
}
export function unsignedToInt8String(u: bigint): string {
  return BigInt.asIntN(64, u).toString();
}
export function int8StringToUnsigned(s: string): bigint {
  if (typeof s !== "string" || !/^-?\d+$/.test(s)) throw new Error("invalid seed");
  const v = BigInt(s);
  if (v < -(1n << 63n) || v > (1n << 63n) - 1n) throw new Error("seed out of int8 range");
  return BigInt.asUintN(64, v);
}

// ---------- Telemetry hash ----------
export function canonicalTelemetry(actions: ReadonlyArray<{ gateIndex: number; lane: number; t: number }>): string {
  return JSON.stringify(actions.map((a) => [a.gateIndex, a.lane, a.t]));
}
export async function sha256Hex(text: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Service ----------
export type ServiceDeps = { repo: BurgerBoostSessionRepository; now: () => number; newId: () => string; seed?: () => string };

export function toDTO(r: SessionRecord): SessionDTO {
  return {
    sessionId: r.id, rulesVersion: r.rulesVersion, gateCount: GATE_COUNT, status: r.status,
    startedAt: r.startedAt, gameplayEndsAt: r.startedAt + GAMEPLAY_WINDOW_MS, expiresAt: r.expiresAt,
  };
}

export function createBurgerBoostSessionService(deps: ServiceDeps) {
  const makeSeed = deps.seed ?? generateSeed;
  return {
    async start(userId: string): Promise<SessionDTO> {
      if (!userId) throw new Error("unauthenticated");
      const startedAt = deps.now();
      const rec: SessionRecord = {
        id: deps.newId(), userId, seed: makeSeed(), rulesVersion: RULES_VERSION, status: "in_progress",
        startedAt, expiresAt: startedAt + HARD_CUTOFF_MS, completedAt: null,
        verifiedScore: null, telemetryHash: null, awardedDiscountPercent: 0,
      };
      await deps.repo.insert(rec);
      return toDTO(rec);
    },

    async get(id: string, userId: string): Promise<SessionDTO | null> {
      const r = await deps.repo.findForUser(id, userId);
      return r ? toDTO(r) : null;
    },

    /** `payload` is untrusted. Only `playerActions` is read; score/seed/discount/telemetryHash are ignored. */
    async submit(id: string, userId: string, payload: unknown): Promise<SubmitResult> {
      const r = await deps.repo.findForUser(id, userId);
      if (!r) return { ok: false, status: "not_found", error: "session not found" };
      if (r.status !== "in_progress") return { ok: false, status: r.status, error: "session not in progress" };

      if (!Number.isFinite(r.startedAt) || !Number.isFinite(r.expiresAt) || r.expiresAt !== r.startedAt + HARD_CUTOFF_MS) {
        return { ok: false, status: "clock_anomaly", error: "inconsistent session timestamps" };
      }
      const now = deps.now();
      if (!Number.isFinite(now)) return { ok: false, status: "clock_anomaly", error: "invalid server clock" };
      if (now < r.startedAt) return { ok: false, status: "clock_anomaly", error: "session start is in the future" };
      const elapsed = now - r.startedAt;
      if (now > r.expiresAt || elapsed > HARD_CUTOFF_MS) {
        await deps.repo.transitionIfInProgress(id, userId, "expired");
        return { ok: false, status: "expired", error: "hard cutoff exceeded" };
      }
      // elapsed <= 60s: normal gameplay; 60s < elapsed <= 75s: grace submission. Both accepted.

      const actions = payload && typeof payload === "object" ? (payload as { playerActions?: unknown }).playerActions : undefined;
      if (!Array.isArray(actions) || actions.length !== GATE_COUNT) {
        return reject(`exactly ${GATE_COUNT} actions required`);
      }
      let seed: bigint;
      try { seed = int8StringToUnsigned(r.seed); } catch { return reject(); }
      const result = simulateBurgerBoostReplay(seed, GATE_COUNT, actions, r.rulesVersion);
      if (!result.valid || result.gatesPassed !== GATE_COUNT) return reject(result.valid ? "incomplete replay" : result.error);

      const hash = await sha256Hex(canonicalTelemetry(actions as { gateIndex: number; lane: number; t: number }[]));
      const won = await deps.repo.completeIfInProgress(id, userId, { verifiedScore: result.score, telemetryHash: hash, completedAt: now });
      if (!won) return { ok: false, status: "completed", error: "session already finalized" };
      return { ok: true, status: "completed" };

      async function reject(error = "invalid replay"): Promise<SubmitResult> {
        await deps.repo.transitionIfInProgress(id, userId, "rejected");
        return { ok: false, status: "rejected", error };
      }
    },
  };
}
