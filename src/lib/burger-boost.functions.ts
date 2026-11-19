/**
 * FLAMIO Burger Boost — server functions / game API (STEP 04H).
 *
 * Boundary: authenticated user -> these server functions -> Session Core ->
 * server session adapter. Identity comes ONLY from `context.userId` (verified
 * claims via requireSupabaseAuth). Score, discount, seed, status, result and
 * authoritative timestamps from the client are never trusted: strict schemas
 * reject any such field outright.
 *
 * Server-only modules (session core, adapter, rate limiter) are loaded with
 * dynamic imports INSIDE handlers so nothing server-side ships to the browser.
 *
 * NO DATABASE INTEGRATION: the default transport fails closed with a sanitized
 * "unavailable" result. No real RPC is called. The game remains disabled.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { publicRewardSettings } from "@/lib/burger-boost-settings";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateTrack, sanitizeGates, type PublicGate } from "@/lib/burger-boost-rules";

export const BB_GATE_COUNT = 30;
export const BB_HARD_CUTOFF_MS = 75_000;
export const CREATE_LIMIT_PER_HOUR = 15;
export const SUBMIT_LIMIT_PER_HOUR = 60;

/* ------------------------------- schemas ------------------------------- */

const uuid = z.string().uuid();

export const createSessionSchema = z.object({}).strict();
export const sessionIdSchema = z.object({ sessionId: uuid }).strict();

const actionSchema = z
  .object({
    gateIndex: z
      .number()
      .int()
      .min(0)
      .max(BB_GATE_COUNT - 1),
    lane: z.union([z.literal(0), z.literal(1)]),
    t: z.number().int().min(0).max(BB_HARD_CUTOFF_MS),
  })
  .strict();

export const submitSchema = z
  .object({
    sessionId: uuid,
    playerActions: z
      .array(actionSchema)
      .length(BB_GATE_COUNT)
      .refine((a) => a.every((x, i) => x.gateIndex === i), "actions out of order")
      .refine(
        (a) => a.every((x, i) => i === 0 || x.t >= (a[i - 1]?.t ?? 0)),
        "timing out of order",
      ),
  })
  .strict();

/* --------------------------- safe responses ---------------------------- */

export const MSG = {
  unauthenticated: "Please sign in to play.",
  rateLimited: "Too many requests. Please wait before trying again.",
  notFound: "Session not found.",
  inactive: "Session is no longer active.",
  invalid: "Invalid gameplay actions.",
  expired: "Session time is over.",
  notDue: "Session is still running.",
  unavailable: "Unable to process game session. Please try again later.",
  attemptUsed: "You've used today's reward try. Practice is still open.",
  ackExpired: "The 15-second start window closed. This reward try wasn't started.",
} as const;

export type SafeSession = {
  sessionId: string;
  rulesVersion: number;
  gateCount: number;
  status: string;
  startedAt: number;
  gameplayEndsAt: number;
  expiresAt: number;
};

/** Explicit allow-list copy: never spreads a server object to the client. */
function safe(d: SafeSession): SafeSession {
  return {
    sessionId: d.sessionId,
    rulesVersion: d.rulesVersion,
    gateCount: d.gateCount,
    status: d.status,
    startedAt: d.startedAt,
    gameplayEndsAt: d.gameplayEndsAt,
    expiresAt: d.expiresAt,
  };
}

/* ------------------------------ core API ------------------------------- */

type Service = {
  start(userId: string): Promise<SafeSession>;
  startPractice?(
    userId: string,
  ): Promise<{ ok: true; session: SafeSession } | { ok: false; reason: string }>;
  get(id: string, userId: string): Promise<SafeSession | null>;
  submit(
    id: string,
    userId: string,
    payload: unknown,
  ): Promise<{ ok: boolean; status: string; error?: string; verifiedScore?: number }>;
  expire(id: string, userId: string): Promise<{ ok: boolean; status: string }>;
};
type RewardDeps = {
  prepare(
    userId: string,
  ): Promise<
    { ok: true; sessionId: string; ackDeadlineAt: number } | { ok: false; reason: string }
  >;
  acknowledge(
    userId: string,
    id: string,
  ): Promise<
    | { ok: true; sessionId: string; rulesVersion: number; startedAt: number; expiresAt: number }
    | { ok: false; reason: string }
  >;
  isReward(userId: string, id: string): Promise<boolean>;
  complete(
    userId: string,
    id: string,
    payload: unknown,
  ): Promise<
    | {
        ok: true;
        verifiedScore: number;
        finalMeter: number;
        outcome: string;
        awardedDiscountPercent: 0;
      }
    | { ok: false; status: string; error: string }
  >;
};
type Limiter = { checkAndRecord(key: string): boolean };
/** Server-only: builds the answer-free gate view for a session the caller owns. */
export type PublicGateLoader = (sessionId: string, userId: string) => Promise<PublicGate[] | null>;
export type ApiDeps = {
  service: Service;
  publicGates: PublicGateLoader;
  createLimiter: Limiter;
  submitLimiter: Limiter;
  callerKey: () => string;
  /** Step 66 reward flow. Absent => reward fails closed as unavailable. */
  reward?: RewardDeps;
};

/**
 * STEP 46C. Re-reads the persisted session (ownership-checked by the repository)
 * and derives the authoritative track from the SERVER seed + rules version.
 * Only `sanitizeGates` output leaves this function; seed and answers never do.
 */
export function createPublicGateLoader(repo: {
  findForUser(id: string, userId: string): Promise<{ seed: string; rulesVersion: number } | null>;
}): PublicGateLoader {
  return async (sessionId, userId) => {
    const rec = await repo.findForUser(sessionId, userId);
    if (!rec) return null;
    const gates = sanitizeGates(generateTrack(rec.seed, rec.rulesVersion, BB_GATE_COUNT));
    return gates.length === BB_GATE_COUNT ? gates : null;
  };
}

function logSafe(where: string, err: unknown) {
  const code = (err as { code?: unknown } | null)?.code;
  console.error(`[burger-boost] ${where} failed`, typeof code === "string" ? code : "error");
}

function requireUser(userId: unknown): string | null {
  return typeof userId === "string" && uuid.safeParse(userId).success ? userId : null;
}

/** Pure, injectable handlers. `userId` MUST be the verified `context.userId`. */
export function createBurgerBoostApi(deps: ApiDeps) {
  return {
    async create(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      if (!createSessionSchema.safeParse(input ?? {}).success)
        return { ok: false as const, error: MSG.invalid };
      if (deps.createLimiter.checkAndRecord(`${deps.callerKey()}|${uid}`))
        return { ok: false as const, error: MSG.rateLimited };
      try {
        // Step 64K: saved games are persisted PRACTICE sessions (v3). Reward stays locked.
        if (typeof deps.service.startPractice !== "function")
          throw new Error("practice_unavailable");
        const started = await deps.service.startPractice(uid);
        if (!started.ok) throw new Error("practice_unavailable");
        const session = safe(started.session);
        const publicGates = await deps.publicGates(session.sessionId, uid);
        if (!publicGates || publicGates.length !== BB_GATE_COUNT)
          throw new Error("gate_unavailable");
        return { ok: true as const, session, publicGates };
      } catch (e) {
        logSafe("create", e);
        return { ok: false as const, error: MSG.unavailable };
      }
    },

    async get(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      const p = sessionIdSchema.safeParse(input);
      if (!p.success) return { ok: false as const, error: MSG.notFound };
      try {
        const s = await deps.service.get(p.data.sessionId, uid);
        return s
          ? { ok: true as const, session: safe(s) }
          : { ok: false as const, error: MSG.notFound };
      } catch (e) {
        logSafe("get", e);
        return { ok: false as const, error: MSG.unavailable };
      }
    },

    async submit(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid)
        return { ok: false as const, status: "unauthenticated", error: MSG.unauthenticated };
      const p = submitSchema.safeParse(input);
      if (!p.success) return { ok: false as const, status: "invalid_input", error: MSG.invalid };
      if (deps.submitLimiter.checkAndRecord(`${deps.callerKey()}|${uid}`)) {
        return { ok: false as const, status: "rate_limited", error: MSG.rateLimited };
      }
      try {
        if (deps.reward && (await deps.reward.isReward(uid, p.data.sessionId))) {
          const rr = await deps.reward.complete(uid, p.data.sessionId, {
            playerActions: p.data.playerActions,
          });
          if (rr.ok)
            return {
              ok: true as const,
              status: "completed" as const,
              verifiedScore: rr.verifiedScore,
              awardedDiscountPercent: 0 as const,
              rewardOutcome: rr.outcome,
            };
          const error =
            rr.status === "not_found"
              ? MSG.notFound
              : rr.status === "expired"
                ? MSG.expired
                : rr.status === "rejected"
                  ? MSG.invalid
                  : rr.status === "unavailable"
                    ? MSG.unavailable
                    : MSG.inactive;
          return { ok: false as const, status: rr.status, error };
        }
        // Only validated actions travel to the core; nothing else from the client.
        const r = await deps.service.submit(p.data.sessionId, uid, {
          playerActions: p.data.playerActions,
        });
        // verifiedScore comes only from the server replay; discount is locked at 0.
        if (r.ok) {
          if (typeof r.verifiedScore !== "number" || !Number.isFinite(r.verifiedScore))
            throw new Error("score_missing");
          return {
            ok: true as const,
            status: "completed" as const,
            verifiedScore: r.verifiedScore,
            awardedDiscountPercent: 0 as const,
          };
        }
        const error =
          r.status === "not_found"
            ? MSG.notFound
            : r.status === "expired"
              ? MSG.expired
              : r.status === "rejected"
                ? MSG.invalid
                : r.status === "clock_anomaly"
                  ? MSG.unavailable
                  : MSG.inactive;
        return {
          ok: false as const,
          status: r.status === "clock_anomaly" ? "unavailable" : r.status,
          error,
        };
      } catch (e) {
        logSafe("submit", e);
        return { ok: false as const, status: "unavailable", error: MSG.unavailable };
      }
    },

    async prepareReward(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      if (!createSessionSchema.safeParse(input ?? {}).success)
        return { ok: false as const, error: MSG.invalid };
      if (deps.createLimiter.checkAndRecord(`${deps.callerKey()}|${uid}|reward`))
        return { ok: false as const, error: MSG.rateLimited };
      if (!deps.reward) return { ok: false as const, error: MSG.unavailable };
      try {
        const r = await deps.reward.prepare(uid);
        if (r.ok)
          return {
            ok: true as const,
            sessionId: r.sessionId,
            ackDeadlineAt: r.ackDeadlineAt,
            ackWindowMs: 15_000,
          };
        return {
          ok: false as const,
          error: r.reason === "attempt_used" ? MSG.attemptUsed : MSG.unavailable,
        };
      } catch (e) {
        logSafe("prepareReward", e);
        return { ok: false as const, error: MSG.unavailable };
      }
    },

    async acknowledgeReward(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      const p = sessionIdSchema.safeParse(input);
      if (!p.success) return { ok: false as const, error: MSG.notFound };
      if (!deps.reward) return { ok: false as const, error: MSG.unavailable };
      try {
        const r = await deps.reward.acknowledge(uid, p.data.sessionId);
        if (!r.ok) {
          const error =
            r.reason === "ack_expired"
              ? MSG.ackExpired
              : r.reason === "attempt_used"
                ? MSG.attemptUsed
                : r.reason === "not_found"
                  ? MSG.notFound
                  : r.reason === "invalid_state"
                    ? MSG.inactive
                    : MSG.unavailable;
          return { ok: false as const, error };
        }
        const publicGates = await deps.publicGates(r.sessionId, uid);
        if (!publicGates || publicGates.length !== BB_GATE_COUNT)
          throw new Error("gate_unavailable");
        const session = safe({
          sessionId: r.sessionId,
          rulesVersion: r.rulesVersion,
          gateCount: BB_GATE_COUNT,
          status: "in_progress",
          startedAt: r.startedAt,
          gameplayEndsAt: r.startedAt + 60_000,
          expiresAt: r.expiresAt,
        });
        return { ok: true as const, session, publicGates };
      } catch (e) {
        logSafe("acknowledgeReward", e);
        return { ok: false as const, error: MSG.unavailable };
      }
    },

    async expire(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      const p = sessionIdSchema.safeParse(input);
      if (!p.success) return { ok: false as const, error: MSG.notFound };
      try {
        const r = await deps.service.expire(p.data.sessionId, uid);
        if (r.ok) return { ok: true as const, status: "expired" as const };
        return {
          ok: false as const,
          error:
            r.status === "not_found"
              ? MSG.notFound
              : r.status === "not_due"
                ? MSG.notDue
                : MSG.inactive,
        };
      } catch (e) {
        logSafe("expire", e);
        return { ok: false as const, error: MSG.unavailable };
      }
    },
  };
}

/* ------------------------- server wiring (lazy) ------------------------- */

let apiPromise: Promise<ReturnType<typeof createBurgerBoostApi>> | null = null;

/** Builds the real API once, server-side only. Init failure fails closed and is retried next call. */
function serverApi() {
  apiPromise ??= (async () => {
    const core = await import("@/lib/burger-boost-session-core");
    const adapter = await import("@/lib/burger-boost-session.server");
    const rl = await import("@/lib/rate-limit.server");
    // Server-only admin client, loaded lazily so it never enters the client graph.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const transport = adapter.createSupabaseBurgerBoostTransport(supabaseAdmin);
    const repo = adapter.createBurgerBoostSessionRepository({ transport });
    const service = core.createBurgerBoostSessionService({
      repo,
      now: () => Date.now(),
      newId: () => globalThis.crypto.randomUUID(),
    });
    const rewardMod = await import("@/lib/burger-boost-reward-service");
    const reward = rewardMod.createRewardService({
      transport: adapter.createSupabaseRewardTransport(supabaseAdmin),
      repo,
      now: () => Date.now(),
      newId: () => globalThis.crypto.randomUUID(),
    });
    return createBurgerBoostApi({
      service,
      publicGates: createPublicGateLoader(repo),
      createLimiter: rl.createRateLimiter(CREATE_LIMIT_PER_HOUR),
      submitLimiter: rl.createRateLimiter(SUBMIT_LIMIT_PER_HOUR),
      callerKey: rl.callerKey,
      reward,
    });
  })();
  apiPromise.catch(() => {
    apiPromise = null;
  });
  return apiPromise;
}

/* --------------------------- server functions --------------------------- */

/** Public scalar only, through the draft's narrow read-only RPC and anon grants. */
export const getBurgerBoostPublicSettings = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_ANON_KEY"];
    if (!url || !key) return publicRewardSettings(null);
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const headers = new Headers(init?.headers);
          if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
            headers.delete("Authorization");
          headers.set("apikey", key);
          return fetch(input, { ...init, headers });
        },
      },
    });
    const { data, error } = await client.schema("burger_boost").rpc("get_public_owner_max");
    return publicRewardSettings(error ? null : data);
  } catch {
    return publicRewardSettings(null);
  }
});

export const createBurgerBoostSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSessionSchema.parse(input ?? {}))
  .handler(async ({ context, data }) => (await serverApi()).create(context.userId, data));

export const getBurgerBoostSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sessionIdSchema.parse(input))
  .handler(async ({ context, data }) => (await serverApi()).get(context.userId, data));

export const submitBurgerBoostGameplay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => submitSchema.parse(input))
  .handler(async ({ context, data }) => (await serverApi()).submit(context.userId, data));

export const expireBurgerBoostSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sessionIdSchema.parse(input))
  .handler(async ({ context, data }) => (await serverApi()).expire(context.userId, data));

export const prepareBurgerBoostRewardSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => createSessionSchema.parse(input ?? {}))
  .handler(async ({ context, data }) => (await serverApi()).prepareReward(context.userId, data));

export const acknowledgeBurgerBoostRewardStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sessionIdSchema.parse(input))
  .handler(async ({ context, data }) =>
    (await serverApi()).acknowledgeReward(context.userId, data),
  );
