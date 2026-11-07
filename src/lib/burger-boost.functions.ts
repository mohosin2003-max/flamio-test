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

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    gateIndex: z.number().int().min(0).max(BB_GATE_COUNT - 1),
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
      .refine((a) => a.every((x, i) => i === 0 || x.t >= (a[i - 1]?.t ?? 0)), "timing out of order"),
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
} as const;

export type SafeSession = {
  sessionId: string; rulesVersion: number; gateCount: number; status: string;
  startedAt: number; gameplayEndsAt: number; expiresAt: number;
};

/** Explicit allow-list copy: never spreads a server object to the client. */
function safe(d: SafeSession): SafeSession {
  return {
    sessionId: d.sessionId, rulesVersion: d.rulesVersion, gateCount: d.gateCount, status: d.status,
    startedAt: d.startedAt, gameplayEndsAt: d.gameplayEndsAt, expiresAt: d.expiresAt,
  };
}

/* ------------------------------ core API ------------------------------- */

type Service = {
  start(userId: string): Promise<SafeSession>;
  get(id: string, userId: string): Promise<SafeSession | null>;
  submit(id: string, userId: string, payload: unknown): Promise<{ ok: boolean; status: string; error?: string }>;
  expire(id: string, userId: string): Promise<{ ok: boolean; status: string }>;
};
type Limiter = { checkAndRecord(key: string): boolean };
export type ApiDeps = { service: Service; createLimiter: Limiter; submitLimiter: Limiter; callerKey: () => string };

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
      if (!createSessionSchema.safeParse(input ?? {}).success) return { ok: false as const, error: MSG.invalid };
      if (deps.createLimiter.checkAndRecord(`${deps.callerKey()}|${uid}`)) return { ok: false as const, error: MSG.rateLimited };
      try {
        return { ok: true as const, session: safe(await deps.service.start(uid)) };
      } catch (e) { logSafe("create", e); return { ok: false as const, error: MSG.unavailable }; }
    },

    async get(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      const p = sessionIdSchema.safeParse(input);
      if (!p.success) return { ok: false as const, error: MSG.notFound };
      try {
        const s = await deps.service.get(p.data.sessionId, uid);
        return s ? { ok: true as const, session: safe(s) } : { ok: false as const, error: MSG.notFound };
      } catch (e) { logSafe("get", e); return { ok: false as const, error: MSG.unavailable }; }
    },

    async submit(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, status: "unauthenticated", error: MSG.unauthenticated };
      const p = submitSchema.safeParse(input);
      if (!p.success) return { ok: false as const, status: "invalid_input", error: MSG.invalid };
      if (deps.submitLimiter.checkAndRecord(`${deps.callerKey()}|${uid}`)) {
        return { ok: false as const, status: "rate_limited", error: MSG.rateLimited };
      }
      try {
        // Only validated actions travel to the core; nothing else from the client.
        const r = await deps.service.submit(p.data.sessionId, uid, { playerActions: p.data.playerActions });
        if (r.ok) return { ok: true as const, status: "completed" };
        const error = r.status === "not_found" ? MSG.notFound
          : r.status === "expired" ? MSG.expired
          : r.status === "rejected" ? MSG.invalid
          : r.status === "clock_anomaly" ? MSG.unavailable
          : MSG.inactive;
        return { ok: false as const, status: r.status === "clock_anomaly" ? "unavailable" : r.status, error };
      } catch (e) { logSafe("submit", e); return { ok: false as const, status: "unavailable", error: MSG.unavailable }; }
    },

    async expire(userId: unknown, input: unknown) {
      const uid = requireUser(userId);
      if (!uid) return { ok: false as const, error: MSG.unauthenticated };
      const p = sessionIdSchema.safeParse(input);
      if (!p.success) return { ok: false as const, error: MSG.notFound };
      try {
        const r = await deps.service.expire(p.data.sessionId, uid);
        if (r.ok) return { ok: true as const, status: "expired" as const };
        return { ok: false as const, error: r.status === "not_found" ? MSG.notFound : r.status === "not_due" ? MSG.notDue : MSG.inactive };
      } catch (e) { logSafe("expire", e); return { ok: false as const, error: MSG.unavailable }; }
    },
  };
}

/* ------------------------- server wiring (lazy) ------------------------- */

let apiPromise: Promise<ReturnType<typeof createBurgerBoostApi>> | null = null;

/** Builds the real API once, server-side only. Schema-scoped RPC transport; fails closed if unavailable. */
function serverApi() {
  apiPromise ??= (async () => {
    const core = await import("@/lib/burger-boost-session-core");
    const adapter = await import("@/lib/burger-boost-session.server");
    const rl = await import("@/lib/rate-limit.server");
    const unavailable = async (): Promise<never> => { throw new adapter.BurgerBoostPersistenceError("persistence_unavailable"); };
    let transport: import("@/lib/burger-boost-session.server").BurgerBoostRpcTransport;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      transport = adapter.createSupabaseBurgerBoostTransport(
        supabaseAdmin as unknown as import("@/lib/burger-boost-session.server").SupabaseSchemaClient,
      );
    } catch {
      // Fail closed when server configuration/transport is unavailable.
      transport = {
        create_session: unavailable, get_session_for_user: unavailable,
        complete_session: unavailable, transition_session: unavailable,
      };
    }
    const repo = adapter.createBurgerBoostSessionRepository({ transport });
    const service = core.createBurgerBoostSessionService({
      repo, now: () => Date.now(), newId: () => globalThis.crypto.randomUUID(),
    });
    return createBurgerBoostApi({
      service,
      createLimiter: rl.createRateLimiter(CREATE_LIMIT_PER_HOUR),
      submitLimiter: rl.createRateLimiter(SUBMIT_LIMIT_PER_HOUR),
      callerKey: rl.callerKey,
    });
  })();
  return apiPromise;
}

/* --------------------------- server functions --------------------------- */

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
