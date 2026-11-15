import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { generateTrack, simulateBurgerBoostReplay, replayDiscountMeter } from "./burger-boost-rules.ts";
import { createBurgerBoostSessionService, int8StringToUnsigned, canonicalTelemetry, sha256Hex, RULES_VERSION } from "./burger-boost-session-core.ts";
import { createBurgerBoostSessionRepository } from "./burger-boost-session.server.ts";
import { createBurgerBoostApi, createPublicGateLoader, MSG } from "./burger-boost.functions.ts";

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
    async create_session(p) { guard(); rows.set(p.p_id, { id: p.p_id, user_id: p.p_user_id, idempotency_key: p.p_idempotency_key, status: "in_progress", seed: p.p_seed, started_at: p.p_started_at, expires_at: p.p_expires_at, completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, rules_version: p.p_rules_version, mode: p.p_rules_version === 1 ? "legacy" : "practice" }); return p.p_id; },
    async get_session_for_user(p) { guard(); const r = rows.get(p.p_id); return r && r.user_id === p.p_user_id ? [{ ...r }] : []; },
    async complete_session(p) { guard(); const r = rows.get(p.p_id); if (!r || r.user_id !== p.p_user_id || r.status !== "in_progress") return false; Object.assign(r, { status: "completed", verified_score: p.p_verified_score, telemetry_hash: p.p_telemetry_hash, completed_at: p.p_completed_at }); return true; },
    async transition_session(p) { guard(); const r = rows.get(p.p_id); if (!r || r.user_id !== p.p_user_id || r.status !== "in_progress") return false; r.status = p.p_target_status; return true; },
  };
}
function limiter(max) { const n = new Map(); return { checkAndRecord(k) { const c = n.get(k) ?? 0; if (c >= max) return true; n.set(k, c + 1); return false; } }; }

function setup({ createMax = 100, submitMax = 100 } = {}) {
  const transport = mockTransport();
  let clock = T0;
  const repo = createBurgerBoostSessionRepository({ transport });
  const service = createBurgerBoostSessionService({ repo, now: () => clock, newId: () => crypto.randomUUID(), seed: () => SEED });
  const api = createBurgerBoostApi({ service, publicGates: createPublicGateLoader(repo), createLimiter: limiter(createMax), submitLimiter: limiter(submitMax), callerKey: () => "1.2.3.4" });
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
    expect(fns.length).toBe(6); // 4 session + 2 reward (Step 66), all authenticated
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
    expect(await s.api.submit(U1, { sessionId: id, playerActions: valid() })).toEqual({ ok: true, status: "completed", verifiedScore: expect.any(Number), awardedDiscountPercent: 0 });
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
    // Step 64K: saved games are persisted v3 practice; replay uses the SERVER seed + v3.
    const server = replayDiscountMeter(int8StringToUnsigned(SEED), 30, forged, 3);
    expect(server.valid).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.awardedDiscountPercent).toBe(0);
    expect(s.transport.rows.get(id).verified_score).toBe(Math.max(0, server.finalMeter));
    expect(s.transport.rows.get(id).awarded_discount_percent).toBe(0);
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
    // supabaseAdmin only via dynamic import inside serverApi()
    const body = src.slice(src.indexOf("function serverApi()"), src.indexOf("/* --------------------------- server functions"));
    expect(body).toContain('await import("@/integrations/supabase/client.server")');
    expect(body).toContain("createSupabaseBurgerBoostTransport(supabaseAdmin)");
    const outside = src.replace(body, "");
    expect(outside).not.toContain("supabaseAdmin");
    expect(outside).not.toContain("client.server");
    expect(src).not.toMatch(/SERVICE_ROLE|service_role/);
    // no base/unqualified RPC calls here; RPCs live in the schema-scoped transport
    expect(src).not.toMatch(/\.rpc\(/);
    const adapterSrc = readFileSync(new URL("./burger-boost-session.server.ts", import.meta.url), "utf8");
    const adapterCode = adapterSrc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    expect(adapterCode.match(/\.rpc\(/g)?.length).toBe(1);
    expect(adapterSrc).toContain("supabase.schema(BB_SCHEMA).rpc(fn, args)");
    expect(adapterSrc).toContain('const BB_SCHEMA = "burger_boost"');
    for (const fn of ["create_session", "get_session_for_user", "complete_session", "transition_session"]) {
      expect(adapterSrc).toContain(`rpc("${fn}", p)`);
    }
  });
});

describe("public gate delivery (STEP 46C)", () => {
  test("create returns session + exactly 30 public gates matching the server track", async () => {
    const r = await setup().api.create(U1, {});
    expect(r.ok).toBe(true);
    expect(Object.keys(r).sort()).toEqual(["ok", "publicGates", "session"]);
    expect(r.publicGates.length).toBe(30);
    expect(r.session.rulesVersion).toBe(3);
    const track = generateTrack(int8StringToUnsigned(SEED), 3, 30);
    r.publicGates.forEach((g, i) => {
      expect(g.kind).toBe(track[i].kind);
      if (g.kind === "math") expect([g.a, g.op, g.b, ...g.lanes]).toEqual([track[i].a, track[i].op, track[i].b, ...track[i].lanes]);
    });
  });

  test("no seed, correctLane or replay data exposed (spoiledLane allowed)", async () => {
    const r = await setup().api.create(U1, {});
    const json = JSON.stringify(r);
    expect(json).not.toContain(SEED);
    expect(json).not.toMatch(/correctLane|seed|score|hash|discount|idempotency/i);
    for (const g of r.publicGates) {
      expect(["a,b,kind,lanes,op", "kind,lanes", "kind,spoiled,spoiledLane"]).toContain(Object.keys(g).sort().join(","));
    }
  });

  test("invalid / unauthenticated create still rejected without gates", async () => {
    const s = setup();
    for (const uid of [undefined, "", "nope"]) expect(await s.api.create(uid, {})).toEqual({ ok: false, error: MSG.unauthenticated });
    for (const bad of [{ seed: "1" }, { publicGates: [] }, { score: 9 }]) expect(await s.api.create(U1, bad)).toEqual({ ok: false, error: MSG.invalid });
    expect(s.transport.rows.size).toBe(0);
  });

  test("gate loader is ownership-bound; missing gates fail closed", async () => {
    const s = setup();
    const id = await started(s);
    const repo = createBurgerBoostSessionRepository({ transport: s.transport });
    expect(await createPublicGateLoader(repo)(id, U2)).toBeNull();
    const api = createBurgerBoostApi({
      service: { start: async () => ({ sessionId: id, rulesVersion: 1, gateCount: 30, status: "in_progress", startedAt: 0, gameplayEndsAt: 60000, expiresAt: 75000 }) },
      publicGates: async () => null, createLimiter: limiter(9), submitLimiter: limiter(9), callerKey: () => "x",
    });
    expect(await api.create(U1, {})).toEqual({ ok: false, error: MSG.unavailable });
  });
});
