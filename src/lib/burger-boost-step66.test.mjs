import { describe, expect, test } from "bun:test";
import { generateTrack, replayDiscountMeter, simulateBurgerBoostReplay } from "./burger-boost-rules.ts";
import { createBurgerBoostSessionService, int8StringToUnsigned, GATE_COUNT } from "./burger-boost-session-core.ts";
import { createBurgerBoostSessionRepository } from "./burger-boost-session.server.ts";
import { createBurgerBoostApi, createPublicGateLoader } from "./burger-boost.functions.ts";
import { createRewardService } from "./burger-boost-reward-service.ts";
import { RELEASE_LOCKS } from "./burger-boost-reward-flow.ts";
import { checkIssue, checkRedeem } from "./burger-boost-coupon.ts";
import { COUPON_VALIDITY_MS } from "./burger-boost-reward.ts";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const SEED = "-1234567890123456789";
const T0 = 1_800_000_000_000;
const iso = (ms) => new Date(ms).toISOString();
const lim = () => ({ checkAndRecord: () => false });

/** Mock of the live TEST RPC contracts (rules version for reward rows = 3 here; 2 also supported). */
function db(rv = 3) {
  const rows = new Map(); const attempts = new Set(); const completions = []; let clock = T0;
  const row = (r) => ({ ...r });
  const t = {
    rows, completions, at: (d) => { clock = T0 + d; }, now: () => clock,
    async create_session(p) { rows.set(p.p_id, { id: p.p_id, user_id: p.p_user_id, status: "in_progress", seed: p.p_seed, started_at: p.p_started_at, expires_at: p.p_expires_at, completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, rules_version: p.p_rules_version, mode: p.p_rules_version === 1 ? "legacy" : "practice", prepared_at: null, ack_deadline_at: null, ack_at: null }); return p.p_id; },
    async get_session_for_user(p) { const r = rows.get(p.p_id); return r && r.user_id === p.p_user_id ? [row(r)] : []; },
    async complete_session(p) { const r = rows.get(p.p_id); if (!r || r.status !== "in_progress" || r.mode === "reward") return false; Object.assign(r, { status: "completed", verified_score: p.p_verified_score, telemetry_hash: p.p_telemetry_hash, completed_at: p.p_completed_at }); return true; },
    async transition_session(p) { const r = rows.get(p.p_id); if (!r || r.user_id !== p.p_user_id || r.status !== "in_progress") return false; r.status = p.p_target_status; return true; },
    async prepare_reward_session(p) {
      if (attempts.has(p.p_user_id)) return { result: "attempt_already_used" };
      const e = [...rows.values()].find((r) => r.user_id === p.p_user_id && r.mode === "reward" && r.status === "prepared" && clock <= Date.parse(r.ack_deadline_at));
      if (e) return { result: "existing_prepared", session_id: e.id, prepared_at: e.prepared_at, ack_deadline_at: e.ack_deadline_at };
      rows.set(p.p_id, { id: p.p_id, user_id: p.p_user_id, status: "prepared", seed: p.p_seed, started_at: null, expires_at: null, completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: 0, rules_version: rv, mode: "reward", prepared_at: iso(clock), ack_deadline_at: iso(clock + 15000), ack_at: null });
      return { result: "prepared", session_id: p.p_id, prepared_at: iso(clock), ack_deadline_at: iso(clock + 15000) };
    },
    async acknowledge_reward_start(p) {
      const r = rows.get(p.p_id);
      if (!r || r.user_id !== p.p_user_id) return { result: "not_found" };
      if (r.mode !== "reward") return { result: "not_reward" };
      if (r.status === "in_progress") return { result: "already_started", session_id: r.id };
      if (r.status !== "prepared") return { result: "invalid_state", status: r.status };
      if (clock > Date.parse(r.ack_deadline_at)) { r.status = "expired"; return { result: "ack_expired" }; }
      if (attempts.has(p.p_user_id)) return { result: "attempt_already_used" };
      attempts.add(p.p_user_id);
      Object.assign(r, { status: "in_progress", ack_at: iso(clock), started_at: iso(clock), expires_at: iso(clock + 75000) });
      return { result: "started", session_id: r.id };
    },
    async complete_reward_session(p) {
      completions.push(p);
      const r = rows.get(p.p_id);
      if (!r || r.user_id !== p.p_user_id || r.mode !== "reward" || r.status !== "in_progress") return { result: "not_eligible" };
      Object.assign(r, { status: "completed", verified_score: Math.max(0, p.p_final_meter), telemetry_hash: p.p_telemetry_hash, completed_at: iso(clock) });
      return { result: p.p_final_meter <= 0 ? "loss" : "release_locked", final_meter: p.p_final_meter, awarded_discount_percent: 0 };
    },
  };
  return t;
}
function setup(rv = 3) {
  const t = db(rv);
  const repo = createBurgerBoostSessionRepository({ transport: t });
  const service = createBurgerBoostSessionService({ repo, now: t.now, newId: () => crypto.randomUUID(), seed: () => SEED });
  const reward = createRewardService({ transport: t, repo, now: t.now, newId: () => crypto.randomUUID(), seed: () => SEED });
  const api = createBurgerBoostApi({ service, publicGates: createPublicGateLoader(repo), createLimiter: lim(), submitLimiter: lim(), callerKey: () => "k", reward });
  return { t, api };
}
const acts = () => Array.from({ length: GATE_COUNT }, (_, i) => ({ gateIndex: i, lane: i % 2, t: i * 1000 }));
const seedU = int8StringToUnsigned(SEED);
async function started(s, user = U1) {
  const p = await s.api.prepareReward(user, {});
  const a = await s.api.acknowledgeReward(user, { sessionId: p.sessionId });
  return { p, a };
}

describe("Step 66 reward session", () => {
  test("authenticated preparation returns only id + deadline (no seed)", async () => {
    const s = setup(); const r = await s.api.prepareReward(U1, {});
    expect(r.ok).toBe(true); expect(r.ackWindowMs).toBe(15000);
    expect(JSON.stringify(r)).not.toContain(SEED);
    expect(s.t.rows.get(r.sessionId).status).toBe("prepared");
  });
  test("unauthenticated preparation is refused", async () => {
    const s = setup(); expect((await s.api.prepareReward(undefined, {})).ok).toBe(false);
    expect((await s.api.prepareReward("not-a-uuid", {})).ok).toBe(false); expect(s.t.rows.size).toBe(0);
  });
  test("client-sent fields on prepare are rejected", async () => {
    const s = setup(); expect((await s.api.prepareReward(U1, { discountPercent: 20 })).ok).toBe(false);
  });
  test("duplicate preparation reuses the existing prepared session", async () => {
    const s = setup(); const a = await s.api.prepareReward(U1, {}); const b = await s.api.prepareReward(U1, {});
    expect(b.sessionId).toBe(a.sessionId); expect(s.t.rows.size).toBe(1);
  });
  test("acknowledgement success starts gameplay with public gates for the persisted version", async () => {
    const s = setup(); const { a } = await started(s);
    expect(a.ok).toBe(true); expect(a.session.rulesVersion).toBe(3); expect(a.publicGates.length).toBe(30);
    expect(a.session.expiresAt - a.session.startedAt).toBe(75000);
  });
  test("wrong user cannot acknowledge another user's session", async () => {
    const s = setup(); const p = await s.api.prepareReward(U1, {});
    const r = await s.api.acknowledgeReward(U2, { sessionId: p.sessionId });
    expect(r.ok).toBe(false); expect(s.t.rows.get(p.sessionId).status).toBe("prepared");
  });
  test("invalid session id is refused", async () => {
    const s = setup(); expect((await s.api.acknowledgeReward(U1, { sessionId: "x" })).ok).toBe(false);
    expect((await s.api.acknowledgeReward(U1, { sessionId: crypto.randomUUID() })).ok).toBe(false);
  });
  test("late acknowledgement (after 15 s) fails and never starts", async () => {
    const s = setup(); const p = await s.api.prepareReward(U1, {}); s.t.at(15001);
    const r = await s.api.acknowledgeReward(U1, { sessionId: p.sessionId });
    expect(r.ok).toBe(false); expect(r.error).toContain("15-second");
    expect(s.t.rows.get(p.sessionId).started_at).toBeNull();
  });
  test("duplicate acknowledgement is idempotent and uses one attempt", async () => {
    const s = setup(); const { p } = await started(s);
    const again = await s.api.acknowledgeReward(U1, { sessionId: p.sessionId });
    expect(again.ok).toBe(true);
    expect((await s.api.prepareReward(U1, {})).error).toContain("today's reward try");
  });
  test("completion uses the server replay meter, discount stays 0", async () => {
    const s = setup(); const { p } = await started(s); s.t.at(30000);
    const r = await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts() });
    const m = replayDiscountMeter(seedU, GATE_COUNT, acts(), 3);
    expect(r.ok).toBe(true); expect(r.awardedDiscountPercent).toBe(0);
    expect(s.t.completions[0].p_final_meter).toBe(m.finalMeter);
    expect(["loss", "release_locked"]).toContain(r.rewardOutcome);
  });
  test("reward v2 rows replay with the v2 track", async () => {
    const s = setup(2); const { p, a } = await started(s); expect(a.session.rulesVersion).toBe(2);
    await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts() });
    expect(s.t.completions[0].p_final_meter).toBe(replayDiscountMeter(seedU, GATE_COUNT, acts(), 2).finalMeter);
  });
  test("duplicate completion is refused", async () => {
    const s = setup(); const { p } = await started(s);
    await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts() });
    const r = await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts() });
    expect(r.ok).toBe(false);
  });
  test("tampered actions (client score/discount fields) are rejected by the schema", async () => {
    const s = setup(); const { p } = await started(s);
    const r = await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts(), discountPercent: 20, score: 999 });
    expect(r.ok).toBe(false); expect(s.t.completions.length).toBe(0);
  });
  test("invalid replay rejects the session without completion", async () => {
    const s = setup(); const { p } = await started(s);
    const bad = acts().map((a, i) => (i === 5 ? { ...a, t: 75000 } : a)); // later timings out of order
    const r = await s.api.submit(U1, { sessionId: p.sessionId, playerActions: bad });
    expect(r.ok).toBe(false); expect(s.t.completions.length).toBe(0);
  });
  test("wrong rules version on a reward row is rejected", async () => {
    const s = setup(); const { p } = await started(s);
    const svc = createRewardService({ transport: s.t, repo: { async findForUser() { return { id: p.sessionId, userId: U1, seed: SEED, rulesVersion: 1, status: "in_progress", startedAt: T0, expiresAt: T0 + 75000, mode: "reward" }; } }, now: s.t.now, newId: () => crypto.randomUUID() });
    const r = await svc.complete(U1, p.sessionId, { playerActions: acts() });
    expect(r.ok).toBe(false); expect(r.status).toBe("rejected"); expect(s.t.completions.length).toBe(0);
  });
  test("completion after the 75 s cutoff expires the session", async () => {
    const s = setup(); const { p } = await started(s); s.t.at(75001);
    const r = await s.api.submit(U1, { sessionId: p.sessionId, playerActions: acts() });
    expect(r.ok).toBe(false); expect(s.t.rows.get(p.sessionId).status).toBe("expired");
  });
  test("no reward deps => reward fails closed", async () => {
    const t = db(); const repo = createBurgerBoostSessionRepository({ transport: t });
    const service = createBurgerBoostSessionService({ repo, now: t.now, newId: () => crypto.randomUUID() });
    const api = createBurgerBoostApi({ service, publicGates: createPublicGateLoader(repo), createLimiter: lim(), submitLimiter: lim(), callerKey: () => "k" });
    expect((await api.prepareReward(U1, {})).ok).toBe(false);
  });
});

const coupon = (o = {}) => ({ id: "c1", userId: U1, sessionId: "s1", discountPercent: 10, status: "active", issuedAt: T0, expiresAt: T0 + COUPON_VALIDITY_MS, redeemedAt: null, ...o });
const open = { checkout: true };
describe("Step 66 coupon lifecycle", () => {
  test("issuance refused while the release lock is on", () => {
    expect(checkIssue({ verifiedDiscount: 10, ownerMax: 20, issuedAt: T0, existingForSession: false }).ok).toBe(false);
  });
  test("7-day expiry, duplicate and owner-max checks (lock lifted only in this test)", () => {
    const L = { couponIssuance: true };
    expect(checkIssue({ verifiedDiscount: 10, ownerMax: 20, issuedAt: T0, existingForSession: false, locks: L })).toEqual({ ok: true, discountPercent: 10, expiresAt: T0 + 7 * 86400000 });
    expect(checkIssue({ verifiedDiscount: 10, ownerMax: 20, issuedAt: T0, existingForSession: true, locks: L }).reason).toBe("duplicate");
    expect(checkIssue({ verifiedDiscount: 25, ownerMax: 20, issuedAt: T0, existingForSession: false, locks: L }).reason).toBe("over_owner_max");
  });
  test("checkout redemption rules", () => {
    const req = { userId: U1, otherCouponApplied: false };
    expect(checkRedeem(coupon(), req, T0 + 1, { locks: open })).toEqual({ ok: true, discountPercent: 10 });
    expect(checkRedeem(null, req, T0, { locks: open }).reason).toBe("not_found");
    expect(checkRedeem(coupon(), { ...req, userId: U2 }, T0, { locks: open }).reason).toBe("wrong_customer");
    expect(checkRedeem(coupon(), req, T0 + COUPON_VALIDITY_MS + 1, { locks: open }).reason).toBe("expired");
    expect(checkRedeem(coupon({ status: "redeemed", redeemedAt: T0 }), req, T0, { locks: open }).reason).toBe("already_used");
    expect(checkRedeem(coupon({ redeemedAt: T0 }), req, T0, { locks: open }).reason).toBe("already_used");
    expect(checkRedeem(coupon(), { ...req, otherCouponApplied: true }, T0, { locks: open }).reason).toBe("stacking");
    expect(checkRedeem(coupon(), { ...req, discountPercent: 20 }, T0, { locks: open }).reason).toBe("invalid");
    expect(checkRedeem(coupon({ discountPercent: 30 }), req, T0, { locks: open, ownerMax: 20 }).reason).toBe("invalid");
    expect(checkRedeem(coupon({ expiresAt: T0 + COUPON_VALIDITY_MS * 2 }), req, T0, { locks: open }).reason).toBe("invalid");
  });
  test("checkout release lock enforced by default", () => {
    expect(checkRedeem(coupon(), { userId: U1, otherCouponApplied: false }, T0).reason).toBe("release_locked");
    expect(RELEASE_LOCKS).toEqual({ couponIssuance: false, checkout: false });
  });
});

describe("Step 66 regression", () => {
  test("practice v3 save still works and is not routed to reward completion", async () => {
    const s = setup(); const c = await s.api.create(U1, {});
    expect(c.session.rulesVersion).toBe(3); expect(c.publicGates.length).toBe(30);
    const r = await s.api.submit(U1, { sessionId: c.session.sessionId, playerActions: acts() });
    expect(r.ok).toBe(true); expect(r.rewardOutcome).toBeUndefined(); expect(s.t.completions.length).toBe(0);
  });
  test("v1 and v2 generation/replay unchanged and 30 gates", () => {
    expect(generateTrack(SEED, 1, 30).length).toBe(30);
    expect(generateTrack(SEED, 2, 30).length).toBe(30);
    const v1 = simulateBurgerBoostReplay(seedU, GATE_COUNT, acts(), 1);
    expect(v1.valid).toBe(true);
    expect(replayDiscountMeter(seedU, GATE_COUNT, acts(), 2).valid).toBe(true);
    expect(GATE_COUNT).toBe(30);
  });
});
