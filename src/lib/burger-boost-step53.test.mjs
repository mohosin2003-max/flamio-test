import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { generateTrack } from "./burger-boost-rules.ts";
import { createBurgerBoostSessionService, int8StringToUnsigned, RULES_VERSION, MODE_RULES_VERSION, GATE_COUNT } from "./burger-boost-session-core.ts";
import { decideCompletion, RELEASE_LOCKS, DRAFT_SETTINGS } from "./burger-boost-reward-flow.ts";
import { dhakaDate, checkCoupon, COUPON_VALIDITY_MS } from "./burger-boost-reward.ts";

const SEED = "-1234567890123456789";

/** Mock transaction contract: session + attempt commit together or not at all. */
function memRepo({ failAttemptInsert = false } = {}) {
  const rows = new Map(); const attempts = new Map();
  return {
    rows, attempts,
    async insert(r) { rows.set(r.id, { ...r }); },
    async insertRewardWithAttempt(r, date) {
      const key = `${r.userId}|${date}`;
      rows.set(r.id, { ...r }); // session first
      if (failAttemptInsert) { rows.delete(r.id); throw new Error("db down"); }
      if (attempts.has(key)) { rows.delete(r.id); return false; } // rollback
      attempts.set(key, r.id); return true;
    },
    async findForUser(id, u) { const r = rows.get(id); return r && r.userId === u ? { ...r } : null; },
    async completeIfInProgress(id, u, upd) { const r = rows.get(id); if (!r || r.userId !== u || r.status !== "in_progress") return false; Object.assign(r, upd, { status: "completed" }); return true; },
    async transitionIfInProgress(id, u, s) { const r = rows.get(id); if (!r || r.userId !== u || r.status !== "in_progress") return false; r.status = s; return true; },
  };
}
function setup(opts) {
  const repo = memRepo(opts); let clock = Date.UTC(2026, 10, 12, 5, 0, 0); let n = 0;
  const svc = createBurgerBoostSessionService({ repo, now: () => clock, newId: () => `s${++n}`, seed: () => SEED });
  return { repo, svc, at: (ms) => { clock = ms; } };
}
const v2Track = generateTrack(int8StringToUnsigned(SEED), 2, GATE_COUNT);
const v1Track = generateTrack(int8StringToUnsigned(SEED), RULES_VERSION, GATE_COUNT);
const acts = (n = GATE_COUNT) => Array.from({ length: n }, (_, i) => ({ gateIndex: i, lane: 0, t: i * 1000 }));
const settings = { ownerMax: 20, partialMax: 10, dailyFullLimit: 1, dailyPartialLimit: 1, minOrderBdt: 300, gateCount: 30 };

describe("replay routing", () => {
  test("v1 session uses v1 engine (unchanged contract, no meter)", async () => {
    const s = setup(); const d = await s.svc.start("u1");
    expect(d.rulesVersion).toBe(1);
    const a = v1Track.map((g, i) => ({ gateIndex: i, lane: g.kind === "negative" ? 1 - g.spoiledLane : 0, t: i * 1000 }));
    const r = await s.svc.submit(d.sessionId, "u1", { playerActions: a });
    expect(r.ok).toBe(true); expect(r.finalMeter).toBeUndefined();
  });
  test("persisted v2 practice session still uses v2 engine and returns meter", async () => {
    const s = setup(); const st = await s.svc.startPractice("u1");
    s.repo.rows.get(st.session.sessionId).rulesVersion = MODE_RULES_VERSION;
    const r = await s.svc.submit(st.session.sessionId, "u1", { playerActions: acts() });
    expect(r.ok).toBe(true); expect(typeof r.finalMeter).toBe("number"); expect(r.mode).toBe("practice");
    expect(r.verifiedScore).toBe(Math.max(0, r.finalMeter));
    expect(v2Track.every((g) => g.kind !== "math")).toBe(true);
  });
  test("unknown rules version rejected", async () => {
    const s = setup(); const d = await s.svc.start("u1");
    s.repo.rows.get(d.sessionId).rulesVersion = 9;
    const r = await s.svc.submit(d.sessionId, "u1", { playerActions: acts() });
    expect(r).toMatchObject({ ok: false, status: "rejected", error: "unsupported rules version" });
  });
  test("duplicate completion is idempotent", async () => {
    const s = setup(); const st = await s.svc.startPractice("u1");
    await s.svc.submit(st.session.sessionId, "u1", { playerActions: acts() });
    const again = await s.svc.submit(st.session.sessionId, "u1", { playerActions: acts() });
    expect(again.ok).toBe(false);
  });
  test("forged payload fields cannot change mode or version", async () => {
    const s = setup(); const st = await s.svc.startPractice("u1");
    const r = await s.svc.submit(st.session.sessionId, "u1", { playerActions: acts(), mode: "reward", rulesVersion: 1, finalMeter: 100 });
    expect(r.mode).toBe("practice"); expect(s.repo.rows.get(st.session.sessionId).rulesVersion).toBe(3);
  });
});

describe("practice / reward attempts", () => {
  test("practice unlimited, never writes attempts", async () => {
    const s = setup();
    for (let i = 0; i < 5; i++) expect((await s.svc.startPractice("u1")).ok).toBe(true);
    expect(s.repo.attempts.size).toBe(0);
  });
  test("one reward per Dhaka day; second rejected and rolled back", async () => {
    const s = setup();
    expect((await s.svc.startReward("u1")).ok).toBe(true);
    const before = s.repo.rows.size;
    expect(await s.svc.startReward("u1")).toEqual({ ok: false, reason: "attempt_used" });
    expect(s.repo.rows.size).toBe(before);
    expect((await s.svc.startReward("u2")).ok).toBe(true);
  });
  test("failed creation consumes nothing", async () => {
    const s = setup({ failAttemptInsert: true });
    expect(await s.svc.startReward("u1")).toEqual({ ok: false, reason: "unavailable" });
    expect(s.repo.attempts.size).toBe(0); expect(s.repo.rows.size).toBe(0);
  });
  test("23:59 vs 00:01 Asia/Dhaka rollover", async () => {
    const s = setup();
    s.at(Date.UTC(2026, 10, 11, 17, 59, 0)); // 23:59 Dhaka 11 Nov
    expect((await s.svc.startReward("u1")).ok).toBe(true);
    s.at(Date.UTC(2026, 10, 11, 18, 1, 0)); // 00:01 Dhaka 12 Nov
    expect((await s.svc.startReward("u1")).ok).toBe(true);
    expect([...s.repo.attempts.keys()]).toEqual(["u1|2026-11-11", "u1|2026-11-12"]);
  });
  test("concurrent same-user starts: exactly one succeeds (mock contract)", async () => {
    const s = setup();
    const rs = await Promise.all([s.svc.startReward("u1"), s.svc.startReward("u1"), s.svc.startReward("u1")]);
    expect(rs.filter((r) => r.ok).length).toBe(1);
  });
  test("abandoned/expired reward does not restore the attempt", async () => {
    const s = setup(); const st = await s.svc.startReward("u1");
    s.repo.rows.get(st.session.sessionId).status = "expired";
    expect((await s.svc.startReward("u1")).ok).toBe(false);
  });
  test("repo without atomic contract fails closed", async () => {
    const repo = memRepo(); delete repo.insertRewardWithAttempt;
    const svc = createBurgerBoostSessionService({ repo, now: () => 1, newId: () => "x", seed: () => SEED });
    expect(await svc.startReward("u1")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("completion decision (release locked)", () => {
  const usage = () => ({ date: dhakaDate(Date.UTC(2026, 10, 12, 5)), fullUsed: 0, partialUsed: 0 });
  const at = Date.UTC(2026, 10, 12, 5);
  test("locks mirror database", () => expect(RELEASE_LOCKS).toEqual({ couponIssuance: false, checkout: false }));
  test("practice and loss never reward", () => {
    expect(decideCompletion({ mode: "practice", finalMeter: 100, settings, usage: usage(), sessionStartedAt: at }).kind).toBe("practice");
    expect(decideCompletion({ mode: undefined, finalMeter: 100, settings, usage: usage(), sessionStartedAt: at }).kind).toBe("practice");
    expect(decideCompletion({ mode: "reward", finalMeter: 0, settings, usage: usage(), sessionStartedAt: at }).kind).toBe("loss");
    expect(decideCompletion({ mode: "reward", finalMeter: -5, settings, usage: usage(), sessionStartedAt: at }).kind).toBe("loss");
  });
  test("locked: eligible win reserves no slot and awards 0%", () => {
    const u = usage();
    const d = decideCompletion({ mode: "reward", finalMeter: 50, settings, usage: u, sessionStartedAt: at });
    expect(d).toEqual({ kind: "release_locked", awardedDiscountPercent: 0, eligibleTier: "full", previewDiscountPercent: 10 });
    expect(u).toEqual(usage());
  });
  test("unlocked model: full first, then partial, then none", () => {
    const u = usage(); const L = { couponIssuance: true };
    expect(decideCompletion({ mode: "reward", finalMeter: 100, settings, usage: u, sessionStartedAt: at, locks: L })).toMatchObject({ kind: "issue", tier: "full", awardedDiscountPercent: 20 });
    expect(decideCompletion({ mode: "reward", finalMeter: 100, settings, usage: u, sessionStartedAt: at, locks: L })).toMatchObject({ kind: "issue", tier: "partial", awardedDiscountPercent: 10 });
    expect(decideCompletion({ mode: "reward", finalMeter: 100, settings, usage: u, sessionStartedAt: at, locks: L })).toMatchObject({ kind: "no_reward", reason: "quota_exhausted" });
    expect(decideCompletion({ mode: "reward", finalMeter: -1, settings, usage: u, sessionStartedAt: at, locks: L }).kind).toBe("loss");
  });
  test("allocation day follows session start, not completion", () => {
    const start = Date.UTC(2026, 10, 11, 17, 59); // 23:59 Dhaka 11 Nov
    const u = { date: "2026-11-11", fullUsed: 0, partialUsed: 0 };
    const d = decideCompletion({ mode: "reward", finalMeter: 100, settings, usage: u, sessionStartedAt: start, locks: { couponIssuance: true } });
    expect(d.kind).toBe("issue"); expect(u).toEqual({ date: "2026-11-11", fullUsed: 1, partialUsed: 0 });
    expect(d.expiresAt).toBe(start + COUPON_VALIDITY_MS);
  });
  test("coupon ownership interface", () => {
    const c = { userId: "u1", discountPercent: 10, issuedAt: at, expiresAt: at + COUPON_VALIDITY_MS, usedAt: null };
    expect(checkCoupon(c, "u2", 500, 300, 0, at)).toEqual({ ok: false, reason: "wrong_user" });
  });
  test("draft defaults invent no business values", () => expect(DRAFT_SETTINGS).toEqual({ ownerMax: 0, partialMax: 0, dailyFullLimit: 0, dailyPartialLimit: 0, minOrderBdt: 0, gateCount: 30 }));
});

describe("locks and checkout isolation (source checks)", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  test("migration locks intact", () => {
    const m = read("../../supabase/migrations/20261104000000_burger_boost_isolated.sql");
    expect(m).toContain("CHECK (game_enabled = false)");
    expect(m).toContain("CHECK (awarded_discount_percent = 0)");
    expect(m).toContain("bb_coupons_phase1_locked CHECK (false)");
  });
  test("draft is labelled, outside migrations, keeps locks", () => {
    const p = "../../docs/burger-boost/drafts/20261112000000_step53_reward_attempts_allocations_DRAFT.sql";
    expect(existsSync(new URL(p, import.meta.url))).toBe(true);
    const d = read(p);
    expect(d).toContain("DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED");
    expect(d).not.toMatch(/DROP CONSTRAINT/i);
    expect(d).toContain("v_issuance_unlocked pg_catalog.bool := false");
  });
  test("checkout never reaches Burger Boost coupons", () => {
    for (const f of ["./orders.functions.ts", "./coupons.functions.ts", "../routes/checkout.tsx"]) {
      const s = read(f); expect(s).not.toContain("burger_boost"); expect(s).not.toContain("burger-boost");
    }
  });
  test("owner overview stays locked", () => {
    const s = read("./burger-boost-owner.functions.ts");
    expect(s).toContain("checkoutEnabled: false as const"); expect(s).toContain("persisted: false as const");
  });
});
