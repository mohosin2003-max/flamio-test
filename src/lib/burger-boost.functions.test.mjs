import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateTrack, simulateBurgerBoostReplay } from "./burger-boost-rules.ts";
import { createBurgerBoostSessionService, int8StringToUnsigned, canonicalTelemetry, sha256Hex, RULES_VERSION } from "./burger-boost-session-core.ts";
import { createBurgerBoostSessionRepository } from "./burger-boost-session.server.ts";
import { createBurgerBoostApi, MSG } from "./burger-boost.functions.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const SEED = "-1234567890123456789";
const OTHER_SEED = "42";
const T0 = 1_800_000_000_000;

/** In-memory mock of the four RPCs (no database). */
function mockTransport() {
  const rows = new Map();
  let fail = null;
  const guard = () => { if (fail) throw fail; };
  return {
    rows, failWith(e) { fail = e; },
    async create_session(p) { guard(); rows.set(p.p_id, { id: p.p_id, user_id: p.p_user_id, idempotency_key: p.p_idempotency_key, status: "in_progress", seed: p.p_seed, started_at: p.p_started_at, expires_at: p.p_expires_at, completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, rules_version: p.p_rules_version }); return p.p_id; },
    async get_session_for_user(p) { guard(); const r = rows.get(p.p_id); return r && r.user_id === p.p_user_id ? [{ ...r }] : []; },
    async complete_session(p) { guard(); const r = rows.get(p.p_id); if (!r || r.user_id !== p.p_user_id || r.status !== "in_progress") return false; Object.assign(r, { status: "completed", verified_score: p.p_verified_score, telemetry_hash: p.p_telemetry_hash, completed_at: p.p_completed_at }); return true; },
    async transition_session(p) { guard(); const r = rows.get(p.p_id); if (!r || r.user_id !== p.p_user_id || r.status !== "in_progress") return false; r.status = p.p_target_status; return true; },
  };
}
function limiter(max) { const n = new Map(); return { checkAndRecord(k) { const c = n.get(k) ?? 0; if (c >= max) return true; n.set(k, c + 1); return false; } }; }

function setup({ createMax = 100, submitMax = 100 } = {}) {
  const transport = mockTransport();
  let clock = T0;
  const service = createBurgerBoostSessionService({ repo: createBurgerBoostSessionRepository({ transport }), now: () => clock, newId: () => crypto.randomUUID(), seed: () => SEED });
  const api = createBurgerBoostApi({ service, createLimiter: limiter(createMax), submitLimiter: limiter(submitMax), callerKey: () => "1.2.3.4" });
  return { api, transport, at: (d) => { clock = T0 + d; } };
}
const actionsFor = (seed) => generateTrack(int8StringToUnsigned(seed), RULES_VERSION, 30).map((g, i) => ({ gateIndex: i, lane: g.kind === "negative" ? 1 - g.spoiledLane : 0, t: i * 1000 }));
const valid = () => actionsFor(SEED);
async function started(s, uid = U1) { const r = await s.api.create(uid, {}); expect(r.ok).toBe(true); return r.session.sessionId; }

describe("burger boost server API (STEP 04H)", () => {
  test("unauthenticated (no verified user id) rejected everywhere", async () => {
    const { api, transport } = setup();
    for (const uid of [undefined, null, "", "not-a-uuid"]) {
      expect((await api.create(uid, {})).error).toBe(MSG.unauthenticated);
      expect((await api.get(uid, { sessionId: U1 })).error).toBe(MSG.unauthenticated);
      expect((await api.submit(uid, { sessionId: U1, playerActions: valid() })).error).toBe(MSG.unauthenticated);
      expect((await api.expire(uid, { sessionId: U1 })).error).toBe(MSG.unauthenticated);
    }
    expect(transport.rows.size).toBe(0);
  });

  test("every server function uses requireSupabaseAuth and context.userId", () => {
    const src = readFileSync(new URL("./burger-boost.functions.ts", import.meta.url), "utf8");
    const fns = src.split("createServerFn(").slice(1);
    expect(fns.length).toBe(4);
    for (const f of fns) {
      expect(f).toContain('{ method: "POST" }');
      expect(f).toContain(".middleware([requireSupabaseAuth])");
      expect(f).toContain("context.userId");
    }
  });

  test("identity from verified id; client userId cannot override", async () => {
    const s = setup();
    expect((await s.api.create(U1, { userId: U2 })).ok).toBe(false);
    const id = await started(s, U1);
    expect(s.transport.rows.get(id).user_id).toBe(U1);
    expect((await s.api.get(U1, { sessionId: id, userId: U2 })).ok).toBe(false);
  });

  test("create response has no seed or internals", async () => {
    const s = setup();
    const r = await s.api.create(U1, {});
    expect(Object.keys(r.session).sort()).toEqual(["expiresAt", "gameplayEndsAt", "gateCount", "rulesVersion", "sessionId", "startedAt", "status"]);
    const json = JSON.stringify(r);
    expect(json).not.toContain(SEED);
    expect(json).not.toMatch(/seed|idempotency|discount|score|hash/i);
    expect(r.session.expiresAt - r.session.startedAt).toBe(75000);
  });

  test("own session retrieval ok; cross-user blocked with identical not-found", async () => {
    const s = setup();
    const id = await started(s);
    expect((await s.api.get(U1, { sessionId: id })).session.sessionId).toBe(id);
    const cross = await s.api.get(U2, { sessionId: id });
    const missing = await s.api.get(U2, { sessionId: crypto.randomUUID() });
    expect(cross).toEqual(missing);
    expect(cross).toEqual({ ok: false, error: MSG.notFound });
  });

  test("malformed actions / not exactly 30 / invalid gate or lane rejected before core", async () => {
    const s = setup();
    const id = await started(s);
    const bad = [
      valid().slice(0, 29), [...valid(), { gateIndex: 29, lane: 0, t: 30000 }], "x", null,
      valid().map((a, i) => (i === 3 ? { ...a, lane: 2 } : a)),
      valid().map((a, i) => (i === 3 ? { ...a, gateIndex: 30 } : a)),
      valid().map((a, i) => (i === 3 ? { ...a, t: -1 } : a)),
      valid().map((a, i) => (i === 3 ? { ...a, t: 1.5 } : a)),
      valid().map((a, i) => (i === 3 ? { gateIndex: 3, lane: 0 } : a)),
    ];
    for (const playerActions of bad) {
      const r = await s.api.submit(U1, { sessionId: id, playerActions });
      expect(r).toEqual({ ok: false, status: "invalid_input", error: MSG.invalid });
    }
    expect(s.transport.rows.get(id).status).toBe("in_progress");
  });

  test("client score / discount / seed / status / result / timestamp fields rejected", async () => {
    const s = setup();
    const id = await started(s);
    const extras = [{ score: 9999 }, { discount: 50 }, { seed: OTHER_SEED }, { status: "completed" }, { result: "win" }, { completedAt: T0 }, { verifiedScore: 1 }];
    for (const extra of extras) {
      const r = await s.api.submit(U1, { sessionId: id, playerActions: valid(), ...extra });
      expect(r.status).toBe("invalid_input");
    }
    const nested = valid().map((a, i) => (i === 0 ? { ...a, score: 9999 } : a));
    expect((await s.api.submit(U1, { sessionId: id, playerActions: nested })).status).toBe("invalid_input");
    expect(s.transport.rows.get(id).status).toBe("in_progress");
  });

  test("valid submission uses server seed; score + hash computed server-side; zero discount", async () => {
    const s = setup();
    const id = await started(s); s.at(30000);
    expect(await s.api.submit(U1, { sessionId: id, playerActions: valid() })).toEqual({ ok: true, status: "completed" });
    const row = s.transport.rows.get(id);
    expect(row.status).toBe("completed");
    expect(row.telemetry_hash).toBe(await sha256Hex(canonicalTelemetry(valid())));
    expect(row.awarded_discount_percent).toBe(0);
  });

  test("score derives from SERVER seed replay, not a client-chosen seed", async () => {
    const s = setup();
    const id = await started(s);
    const forged = actionsFor(OTHER_SEED);
    const r = await s.api.submit(U1, { sessionId: id, playerActions: forged });
    const server = simulateBurgerBoostReplay(int8StringToUnsigned(SEED), 30, forged, RULES_VERSION);
    const client = simulateBurgerBoostReplay(int8StringToUnsigned(OTHER_SEED), 30, forged, RULES_VERSION);
    expect(server.valid).toBe(true);
    expect(r.ok).toBe(true);
    expect(s.transport.rows.get(id).verified_score).toBe(server.score);
    expect(server.score).not.toBe(client.score);
  });

  test("action order preserved: out-of-order rejected", async () => {
    const s = setup();
    const id = await started(s);
    const a = valid(); [a[3], a[4]] = [a[4], a[3]];
    expect((await s.api.submit(U1, { sessionId: id, playerActions: a })).status).toBe("invalid_input");
    const b = valid(); b[5] = { ...b[5], t: 0 };
    expect((await s.api.submit(U1, { sessionId: id, playerActions: b })).status).toBe("invalid_input");
  });

  test("duplicate completion cannot complete twice or re-score", async () => {
    const s = setup();
    const id = await started(s);
    expect((await s.api.submit(U1, { sessionId: id, playerActions: valid() })).ok).toBe(true);
    const snapshot = { ...s.transport.rows.get(id) };
    const again = await s.api.submit(U1, { sessionId: id, playerActions: valid() });
    expect(again).toEqual({ ok: false, status: "completed", error: MSG.inactive });
    expect(s.transport.rows.get(id)).toEqual(snapshot);
  });

  test("75 s cutoff: 75000 accepted, 75001 expired", async () => {
    const a = setup(); const ia = await started(a); a.at(75000);
    expect((await a.api.submit(U1, { sessionId: ia, playerActions: valid() })).ok).toBe(true);
    const b = setup(); const ib = await started(b); b.at(75001);
    expect(await b.api.submit(U1, { sessionId: ib, playerActions: valid() })).toEqual({ ok: false, status: "expired", error: MSG.expired });
    expect(b.transport.rows.get(ib).status).toBe("expired");
  });

  test("expire: server clock only, in_progress -> expired, owner only", async () => {
    const s = setup();
    const id = await started(s); s.at(75000);
    expect(await s.api.expire(U1, { sessionId: id })).toEqual({ ok: false, error: MSG.notDue });
    expect((await s.api.expire(U1, { sessionId: id, now: T0 + 999999 })).ok).toBe(false);
    s.at(75001);
    expect(await s.api.expire(U2, { sessionId: id })).toEqual({ ok: false, error: MSG.notFound });
    expect(await s.api.expire(U1, { sessionId: id })).toEqual({ ok: true, status: "expired" });
    expect(await s.api.expire(U1, { sessionId: id })).toEqual({ ok: false, error: MSG.inactive });
  });

  test("arbitrary status transition rejected", async () => {
    const s = setup();
    const id = await started(s); s.at(80000);
    for (const extra of [{ status: "completed" }, { targetStatus: "completed" }, { status: "rejected" }]) {
      expect((await s.api.expire(U1, { sessionId: id, ...extra })).ok).toBe(false);
    }
    expect(s.transport.rows.get(id).status).toBe("in_progress");
  });

  test("raw/internal errors sanitized", async () => {
    const s = setup();
    const id = await started(s);
    const raw = Object.assign(new Error('relation "burger_boost.sessions" violates constraint secret-xyz'), { code: "23505", details: "seed=" + SEED, hint: "h" });
    s.transport.failWith(raw);
    const errSpy = console.error; const logged = []; console.error = (...a) => logged.push(a.join(" "));
    try {
      const outs = [await s.api.create(U1, {}), await s.api.get(U1, { sessionId: id }), await s.api.submit(U1, { sessionId: id, playerActions: valid() }), await s.api.expire(U1, { sessionId: id })];
      for (const o of outs) {
        const j = JSON.stringify(o);
        expect(o.ok).toBe(false);
        expect(o.error).toBe(MSG.unavailable);
        expect(j).not.toMatch(/23505|burger_boost|secret|seed|stack|hint/i);
      }
      expect(logged.join(" ")).not.toContain(SEED);
    } finally { console.error = errSpy; }
  });

  test("rate limiting enforced for create and submit", async () => {
    const s = setup({ createMax: 2, submitMax: 1 });
    await started(s); const id = await started(s);
    expect(await s.api.create(U1, {})).toEqual({ ok: false, error: MSG.rateLimited });
    await s.api.submit(U1, { sessionId: id, playerActions: valid() });
    expect((await s.api.submit(U1, { sessionId: id, playerActions: valid() })).status).toBe("rate_limited");
  });

  test("server-only isolation: no static import of server-only modules", () => {
    const src = readFileSync(new URL("./burger-boost.functions.ts", import.meta.url), "utf8");
    const staticImports = src.split("\n").filter((l) => /^import /.test(l)).join("\n");
    expect(staticImports).not.toMatch(/session-core|session\.server|rate-limit\.server|client\.server/);
    expect(src).not.toContain("supabaseAdmin");
    expect(src).not.toMatch(/\.rpc\(/);
  });
});
