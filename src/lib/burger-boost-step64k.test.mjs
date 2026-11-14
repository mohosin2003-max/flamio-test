import { describe, expect, test } from "bun:test";
import { generateTrack, sanitizeGates, replayDiscountMeter, simulateBurgerBoostReplay } from "./burger-boost-rules.ts";
import { createBurgerBoostSessionService, int8StringToUnsigned, RULES_VERSION, PRACTICE_RULES_VERSION, GATE_COUNT } from "./burger-boost-session-core.ts";
import { createBurgerBoostSessionRepository, parseSessionRow } from "./burger-boost-session.server.ts";
import { createBurgerBoostApi, createPublicGateLoader } from "./burger-boost.functions.ts";
import { createLiveGame } from "./burger-boost-game.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const SEED = "-1234567890123456789";
const T0 = 1_800_000_000_000;
const lim = () => ({ checkAndRecord: () => false });

function transport() {
  const rows = new Map(); const calls = [];
  return {
    rows, calls,
    async create_session(p) { calls.push(p); if (![1, 2, 3].includes(p.p_rules_version)) throw new Error("bad version"); rows.set(p.p_id, { id: p.p_id, user_id: p.p_user_id, status: "in_progress", seed: p.p_seed, started_at: p.p_started_at, expires_at: p.p_expires_at, completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, rules_version: p.p_rules_version, mode: p.p_rules_version === 1 ? "legacy" : "practice", prepared_at: null, ack_deadline_at: null, ack_at: null }); return p.p_id; },
    async get_session_for_user(p) { const r = rows.get(p.p_id); return r && r.user_id === p.p_user_id ? [{ ...r }] : []; },
    async complete_session(p) { const r = rows.get(p.p_id); if (!r || r.status !== "in_progress") return false; Object.assign(r, { status: "completed", verified_score: p.p_verified_score, telemetry_hash: p.p_telemetry_hash, completed_at: p.p_completed_at }); return true; },
    async transition_session(p) { const r = rows.get(p.p_id); if (!r || r.status !== "in_progress") return false; r.status = p.p_target_status; return true; },
  };
}
function setup() {
  const t = transport(); let clock = T0;
  const repo = createBurgerBoostSessionRepository({ transport: t });
  const service = createBurgerBoostSessionService({ repo, now: () => clock, newId: () => crypto.randomUUID(), seed: () => SEED });
  const api = createBurgerBoostApi({ service, publicGates: createPublicGateLoader(repo), createLimiter: lim(), submitLimiter: lim(), callerKey: () => "k" });
  return { t, service, api, at: (d) => { clock = T0 + d; } };
}
const acts = () => Array.from({ length: GATE_COUNT }, (_, i) => ({ gateIndex: i, lane: i % 2, t: i * 1000 }));
const seedU = int8StringToUnsigned(SEED);

describe("Step 64K: persisted v3 practice", () => {
  test("public create starts practice v3 with exact int8 seed and v3 public gates", async () => {
    const s = setup();
    const r = await s.api.create(U1, {});
    expect(r.ok).toBe(true);
    expect(r.session.rulesVersion).toBe(3);
    expect(PRACTICE_RULES_VERSION).toBe(3);
    expect(s.t.calls[0].p_rules_version).toBe(3);
    expect(s.t.calls[0].p_seed).toBe(SEED);
    expect(s.t.rows.get(r.session.sessionId).mode).toBe("practice");
    expect(r.publicGates).toEqual(sanitizeGates(generateTrack(seedU, 3, 30)));
    expect(JSON.stringify(r)).not.toContain(SEED);
  });

  test("create fails closed when startPractice is unavailable or not ok", async () => {
    for (const service of [{ start: async () => { throw new Error("x"); } }, { start: async () => ({}), startPractice: async () => ({ ok: false, reason: "unavailable" }) }]) {
      const api = createBurgerBoostApi({ service, publicGates: async () => [], createLimiter: lim(), submitLimiter: lim(), callerKey: () => "k" });
      expect((await api.create(U1, {})).ok).toBe(false);
    }
  });

  test("persisted v3 practice replay uses tiered v3 track; forged fields ignored; discount 0", async () => {
    const s = setup();
    const st = await s.service.startPractice(U1);
    s.at(30000);
    const r = await s.service.submit(st.session.sessionId, U1, { playerActions: acts(), seed: "1", finalMeter: 999, rulesVersion: 2, mode: "reward", discount: 50 });
    const v3 = replayDiscountMeter(seedU, 30, acts(), 3);
    expect(r).toMatchObject({ ok: true, rulesVersion: 3, mode: "practice", finalMeter: v3.finalMeter, verifiedScore: Math.max(0, v3.finalMeter) });
    expect(s.t.rows.get(st.session.sessionId).awarded_discount_percent).toBe(0);
  });

  test("persisted v2 practice replay unchanged", async () => {
    const s = setup();
    const st = await s.service.startPractice(U1);
    s.t.rows.get(st.session.sessionId).rules_version = 2;
    s.at(30000);
    const r = await s.service.submit(st.session.sessionId, U1, { playerActions: acts() });
    expect(r).toMatchObject({ ok: true, rulesVersion: 2, finalMeter: replayDiscountMeter(seedU, 30, acts()).finalMeter });
  });

  test("v1 legacy replay unchanged", async () => {
    const s = setup();
    const d = await s.service.start(U1);
    expect(d.rulesVersion).toBe(RULES_VERSION);
    expect(s.t.rows.get(d.sessionId).mode).toBe("legacy");
    const a = generateTrack(seedU, 1, 30).map((g, i) => ({ gateIndex: i, lane: g.kind === "negative" ? 1 - g.spoiledLane : 0, t: i * 1000 }));
    s.at(30000);
    const r = await s.service.submit(d.sessionId, U1, { playerActions: a });
    expect(r).toEqual({ ok: true, status: "completed", verifiedScore: simulateBurgerBoostReplay(seedU, 30, a, 1).score });
  });

  test("public gates follow the persisted rules version", async () => {
    const s = setup();
    const st = await s.service.startPractice(U1);
    const load = createPublicGateLoader(createBurgerBoostSessionRepository({ transport: s.t }));
    expect(await load(st.session.sessionId, U1)).toEqual(sanitizeGates(generateTrack(seedU, 3, 30)));
    s.t.rows.get(st.session.sessionId).rules_version = 2;
    expect(await load(st.session.sessionId, U1)).toEqual(sanitizeGates(generateTrack(seedU, 2, 30)));
  });

  test("live game adopts server-declared v3 and rejects mismatches", () => {
    const g3 = sanitizeGates(generateTrack(seedU, 3, 30));
    expect(createLiveGame({ sessionId: "x", publicGates: g3, expiresAt: 0, rulesVersion: 3 }).rulesVersion).toBe(3);
    expect(createLiveGame({ sessionId: "x", publicGates: g3, expiresAt: 0 }).rulesVersion).toBe(2);
    expect(createLiveGame({ sessionId: "x", publicGates: g3, expiresAt: 0, rulesVersion: 1 })).toBeNull();
    const g1 = sanitizeGates(generateTrack(seedU, 1, 30));
    expect(createLiveGame({ sessionId: "x", publicGates: g1, expiresAt: 0, rulesVersion: 3 })).toBeNull();
  });
});

describe("Step 64K: row parser mode/version", () => {
  const ts = "2026-11-14T10:00:00.000Z";
  const base = { id: U1, user_id: U1, status: "in_progress", seed: "9223372036854775807", started_at: ts, expires_at: "2026-11-14T10:01:15.000Z", completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, prepared_at: null, ack_deadline_at: null, ack_at: null };
  test("practice v2/v3 accepted, legacy only v1", () => {
    for (const v of [2, 3]) expect(parseSessionRow({ ...base, mode: "practice", rules_version: v }).record.rulesVersion).toBe(v);
    expect(parseSessionRow({ ...base, mode: "legacy", rules_version: 1 }).kind).toBe("started");
    expect(parseSessionRow({ ...base, rules_version: 1 }).record.seed).toBe("9223372036854775807");
    for (const [mode, v] of [["legacy", 2], ["legacy", 3], ["practice", 1], ["practice", 4], ["reward", 1], ["reward", 4]]) {
      expect(() => parseSessionRow({ ...base, mode, rules_version: v })).toThrow();
    }
  });
  test("reward v2/v3 prepared rows parse as unstarted (non-playable)", () => {
    for (const v of [2, 3]) {
      const p = parseSessionRow({ ...base, mode: "reward", rules_version: v, status: "prepared", started_at: null, expires_at: null, prepared_at: ts, ack_deadline_at: "2026-11-14T10:00:15.000Z" });
      expect(p.kind).toBe("unstarted"); expect(p.record.rulesVersion).toBe(v);
    }
  });
  test("non-zero discount rejected", () => {
    expect(() => parseSessionRow({ ...base, mode: "practice", rules_version: 3, awarded_discount_percent: 5 })).toThrow();
  });
});
