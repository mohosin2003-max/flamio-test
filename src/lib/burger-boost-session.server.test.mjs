import { describe, expect, test } from "bun:test";
import {
  createBurgerBoostSessionRepository, mapPersistenceError, BurgerBoostPersistenceError,
  msToTimestamptz, timestamptzToMs, normalizeInt8, rowToRecord,
} from "./burger-boost-session.server.ts";

const U = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const H = "a".repeat(64);
const T0 = 1_800_000_000_000;

function mock(overrides = {}) {
  const calls = [];
  const t = {
    async create_session(p) { calls.push(["create_session", p]); return S; },
    async get_session_for_user(p) { calls.push(["get_session_for_user", p]); return []; },
    async complete_session(p) { calls.push(["complete_session", p]); return true; },
    async transition_session(p) { calls.push(["transition_session", p]); return true; },
    ...overrides,
  };
  return { t, calls };
}
const rec = (o = {}) => ({
  id: S, userId: U, seed: "-9223372036854775808", rulesVersion: 1, status: "in_progress",
  startedAt: T0, expiresAt: T0 + 75_000, completedAt: null, verifiedScore: null, telemetryHash: null,
  awardedDiscountPercent: 0, ...o,
});
const row = (o = {}) => ({
  id: S, user_id: U, idempotency_key: S, status: "in_progress", seed: "9223372036854775807",
  started_at: "2027-01-15T08:00:00.000Z", expires_at: "2027-01-15T08:01:15.000Z",
  completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: "0.00", rules_version: 1, ...o,
});

describe("create_session mapping", () => {
  test("exact params, int8 string, ISO timestamps", async () => {
    const { t, calls } = mock();
    await createBurgerBoostSessionRepository({ transport: t }).insert(rec());
    expect(calls).toEqual([["create_session", {
      p_user_id: U, p_seed: "-9223372036854775808", p_rules_version: 1, p_idempotency_key: S,
      p_started_at: new Date(T0).toISOString(), p_expires_at: new Date(T0 + 75_000).toISOString(),
    }]]);
    expect(typeof calls[0][1].p_seed).toBe("string");
  });
  test("returned id mismatch fails closed", async () => {
    const { t } = mock({ async create_session() { return U2; } });
    await expect(createBurgerBoostSessionRepository({ transport: t }).insert(rec())).rejects.toMatchObject({ code: "conflict" });
  });
  test("non-uuid user rejected before transport", async () => {
    const { t, calls } = mock();
    await expect(createBurgerBoostSessionRepository({ transport: t }).insert(rec({ userId: "x" }))).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.length).toBe(0);
  });
});

describe("get_session_for_user mapping", () => {
  test("maps row exactly, preserves int8 max", async () => {
    const { t, calls } = mock({ async get_session_for_user(p) { calls.push(p); return [row()]; } });
    const r = await createBurgerBoostSessionRepository({ transport: t }).findForUser(S, U);
    expect(calls[0]).toEqual({ p_id: S, p_user_id: U });
    expect(r.seed).toBe("9223372036854775807");
    expect(r.startedAt).toBe(Date.parse("2027-01-15T08:00:00.000Z"));
    expect(r.expiresAt - r.startedAt).toBe(75_000);
    expect(r.completedAt).toBeNull(); expect(r.verifiedScore).toBeNull(); expect(r.telemetryHash).toBeNull();
    expect(r.awardedDiscountPercent).toBe(0);
  });
  test("empty -> null; wrong-user row -> error", async () => {
    const { t } = mock();
    expect(await createBurgerBoostSessionRepository({ transport: t }).findForUser(S, U)).toBeNull();
    const { t: t2 } = mock({ async get_session_for_user() { return [row({ user_id: U2 })]; } });
    await expect(createBurgerBoostSessionRepository({ transport: t2 }).findForUser(S, U)).rejects.toMatchObject({ code: "invalid_row" });
  });
  test("malformed id returns null without transport call", async () => {
    const { t, calls } = mock();
    expect(await createBurgerBoostSessionRepository({ transport: t }).findForUser("../x", U)).toBeNull();
    expect(calls.length).toBe(0);
  });
  test("completed row with score 0 is valid", () => {
    const r = rowToRecord(row({ status: "completed", completed_at: "2027-01-15T08:01:00.000Z", verified_score: 0, telemetry_hash: H }));
    expect(r.verifiedScore).toBe(0);
  });
  test("inconsistent nullable fields rejected", () => {
    expect(() => rowToRecord(row({ status: "completed" }))).toThrow(BurgerBoostPersistenceError);
    expect(() => rowToRecord(row({ status: "expired", verified_score: 5 }))).toThrow(BurgerBoostPersistenceError);
    expect(() => rowToRecord(row({ awarded_discount_percent: "5.00" }))).toThrow(BurgerBoostPersistenceError);
    expect(() => rowToRecord(row({ status: "bogus" }))).toThrow(BurgerBoostPersistenceError);
  });
});

describe("complete_session mapping", () => {
  test("exact params and boolean passthrough", async () => {
    const { t, calls } = mock({ async complete_session(p) { calls.push(p); return false; } });
    const ok = await createBurgerBoostSessionRepository({ transport: t })
      .completeIfInProgress(S, U, { verifiedScore: 0, telemetryHash: H, completedAt: T0 + 60_000 });
    expect(ok).toBe(false);
    expect(calls[0]).toEqual({ p_id: S, p_user_id: U, p_verified_score: 0, p_telemetry_hash: H, p_completed_at: new Date(T0 + 60_000).toISOString() });
  });
  test("invalid score/hash rejected before transport", async () => {
    const { t, calls } = mock();
    const repo = createBurgerBoostSessionRepository({ transport: t });
    await expect(repo.completeIfInProgress(S, U, { verifiedScore: -1, telemetryHash: H, completedAt: T0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(repo.completeIfInProgress(S, U, { verifiedScore: 1, telemetryHash: "ABC", completedAt: T0 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.length).toBe(0);
  });
});

describe("transition_session mapping", () => {
  test("expired/rejected mapped; others rejected", async () => {
    const { t, calls } = mock();
    const repo = createBurgerBoostSessionRepository({ transport: t });
    expect(await repo.transitionIfInProgress(S, U, "expired")).toBe(true);
    expect(await repo.transitionIfInProgress(S, U, "rejected")).toBe(true);
    await expect(repo.transitionIfInProgress(S, U, "completed")).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.map((c) => c[1])).toEqual([
      { p_id: S, p_user_id: U, p_target_status: "expired" },
      { p_id: S, p_user_id: U, p_target_status: "rejected" },
    ]);
  });
  test("non-true transport result is false", async () => {
    const { t } = mock({ async transition_session() { return null; } });
    expect(await createBurgerBoostSessionRepository({ transport: t }).transitionIfInProgress(S, U, "expired")).toBe(false);
  });
});

describe("int8 & timestamps", () => {
  test("int8 bounds exact; JS number rejected; overflow rejected", () => {
    expect(normalizeInt8("-9223372036854775808")).toBe("-9223372036854775808");
    expect(normalizeInt8(9223372036854775807n)).toBe("9223372036854775807");
    expect(normalizeInt8("0")).toBe("0");
    expect(() => normalizeInt8(9007199254740993)).toThrow();
    expect(() => normalizeInt8("9223372036854775808")).toThrow();
  });
  test("ms <-> ISO round trip; invalid rejected", () => {
    expect(timestamptzToMs(msToTimestamptz(T0))).toBe(T0);
    expect(timestamptzToMs("2027-01-15 08:00:00+00")).toBe(Date.parse("2027-01-15T08:00:00Z"));
    expect(() => msToTimestamptz(1.5)).toThrow();
    expect(() => timestamptzToMs("nope")).toThrow();
  });
});

describe("safe error mapping", () => {
  test("codes mapped, internals never leaked", async () => {
    const secret = { code: "42P01", message: 'relation "burger_boost.sessions" does not exist', details: "SELECT * FROM x", hint: "pg" };
    const e = mapPersistenceError(secret);
    expect(e.code).toBe("persistence_unavailable");
    expect(JSON.stringify({ m: e.message, ...e })).not.toMatch(/burger_boost\.|SELECT|relation|pg/);
    expect(mapPersistenceError({ code: "22023" }).code).toBe("invalid_input");
    expect(mapPersistenceError({ code: "P0001", message: "BB create_session: idempotency key conflict" }).code).toBe("conflict");
    const { t } = mock({ async create_session() { throw secret; } });
    try { await createBurgerBoostSessionRepository({ transport: t }).insert(rec()); throw new Error("no"); }
    catch (err) { expect(err).toBeInstanceOf(BurgerBoostPersistenceError); expect(String(err.message)).not.toMatch(/relation|sessions/); }
  });
});
