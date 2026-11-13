import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSessionRow, rowToRecord, BurgerBoostPersistenceError } from "./burger-boost-session.server.ts";

const U = "11111111-1111-4111-8111-111111111111";
const S = "33333333-3333-4333-8333-333333333333";
const H = "a".repeat(64);
const P = "2027-01-15T08:00:00.000Z";
const D = "2027-01-15T08:00:15.000Z";
const ST = "2027-01-15T08:00:05.000Z";
const EX = "2027-01-15T08:01:20.000Z";
const base = { id: S, user_id: U, idempotency_key: S, seed: "42", completed_at: null, verified_score: null, telemetry_hash: null, awarded_discount_percent: "0.00" };
const legacy = (o = {}) => ({ ...base, status: "in_progress", rules_version: 1, started_at: "2027-01-15T08:00:00.000Z", expires_at: "2027-01-15T08:01:15.000Z", ...o });
const prepared = (o = {}) => ({ ...base, status: "prepared", rules_version: 2, mode: "reward", started_at: null, expires_at: null, prepared_at: P, ack_deadline_at: D, ack_at: null, ...o });
const rewardLive = (o = {}) => ({ ...base, status: "in_progress", rules_version: 2, mode: "reward", started_at: ST, expires_at: EX, prepared_at: P, ack_deadline_at: D, ack_at: ST, ...o });
const invalid = (r) => { try { parseSessionRow(r); return null; } catch (e) { return e.code; } };

describe("Step 60 SQL correction draft (static contract)", () => {
  const sql = readFileSync("docs/burger-boost/drafts/20261113000000_step60_base_rpc_bypass_FIX_DRAFT.sql", "utf8");
  const fn = (name) => sql.slice(sql.indexOf(`CREATE OR REPLACE FUNCTION burger_boost.${name}(`), sql.indexOf("$fn$;", sql.indexOf(`burger_boost.${name}(`)));
  test("labelled draft, no DROP, no migration path", () => {
    expect(sql).toContain("DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED");
    expect(sql).not.toMatch(/DROP\s+(FUNCTION|CONSTRAINT|TABLE)/i);
  });
  for (const name of ["complete_session", "transition_session"]) {
    test(`${name}: reward excluded, legacy+practice kept, definer/path kept`, () => {
      const body = fn(name);
      expect(body).toContain("AND s.mode IN ('legacy','practice')");
      expect(body).not.toMatch(/'reward'/);
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("SET search_path = pg_catalog, burger_boost, pg_temp");
      expect(body).toContain("AND s.status = 'in_progress'");
    });
  }
  test("complete_session keeps the legacy 75s window checks", () => {
    const b = fn("complete_session");
    expect(b).toContain("p_completed_at >= s.started_at");
    expect(b).toContain("p_completed_at <= s.expires_at");
    expect(b).toContain("make_interval(secs => 75)");
  });
  test("grants: revoke from client roles, execute to service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION burger_boost\.complete_session\([^)]*\) FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION burger_boost\.transition_session\([^)]*\) TO service_role;/);
    expect(sql).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
  });
  test("simulated WHERE clause: reward in_progress never matched", () => {
    const allowed = (row) => ["legacy", "practice"].includes(row.mode) && row.status === "in_progress";
    expect(allowed({ mode: "reward", status: "in_progress" })).toBe(false);
    expect(allowed({ mode: "legacy", status: "in_progress" })).toBe(true);
    expect(allowed({ mode: "practice", status: "in_progress" })).toBe(true);
  });
  test("Step 58 draft and base migration untouched by this step", () => {
    const s58 = readFileSync("docs/burger-boost/drafts/20261112020000_step58_two_phase_replacement_DRAFT.sql", "utf8");
    expect(s58.split("\n").length - 1).toBe(618);
    const baseSql = readFileSync("supabase/migrations/20261104000000_burger_boost_isolated.sql", "utf8");
    expect(baseSql).not.toContain("s.mode");
  });
});

describe("adapter: prepared Reward rows", () => {
  test("prepared row with null started/expires accepted, no fake times", () => {
    const p = parseSessionRow(prepared());
    expect(p.kind).toBe("unstarted");
    expect(p.record.startedAt).toBeNull();
    expect(p.record.expiresAt).toBeNull();
    expect(p.record.preparedAt).toBe(Date.parse(P));
    expect(p.record.ackDeadlineAt).toBe(Date.parse(D));
  });
  test("unacknowledged expired Reward row accepted as unstarted", () => {
    expect(parseSessionRow(prepared({ status: "expired" })).kind).toBe("unstarted");
  });
  test("rowToRecord fails closed with not_started (not invalid_row) for prepared", () => {
    try { rowToRecord(prepared()); throw new Error("no"); }
    catch (e) { expect(e).toBeInstanceOf(BurgerBoostPersistenceError); expect(e.code).toBe("not_started"); }
  });
  test("prepared requires prepared_at and a 15s ack deadline", () => {
    expect(invalid(prepared({ prepared_at: null }))).toBe("invalid_row");
    expect(invalid(prepared({ ack_deadline_at: null }))).toBe("invalid_row");
    expect(invalid(prepared({ ack_deadline_at: "2027-01-15T08:00:16.000Z" }))).toBe("invalid_row");
    expect(invalid(prepared({ prepared_at: "garbage" }))).toBe("invalid_row");
  });
  test("prepared with a start, ack, or half-null timestamps rejected", () => {
    expect(invalid(prepared({ started_at: ST, expires_at: EX }))).toBe("invalid_row");
    expect(invalid(prepared({ ack_at: ST }))).toBe("invalid_row");
    expect(invalid(prepared({ expires_at: EX }))).toBe("invalid_row");
  });
  test("null start only allowed for reward mode", () => {
    expect(invalid(legacy({ started_at: null, expires_at: null }))).toBe("invalid_row");
    expect(invalid({ ...prepared(), mode: "practice", prepared_at: null, ack_deadline_at: null })).toBe("invalid_row");
  });
  test("prepared status for legacy/practice rejected", () => {
    expect(invalid(legacy({ status: "prepared" }))).toBe("invalid_row");
  });
});

describe("adapter: started sessions keep strict validation", () => {
  test("acknowledged reward in_progress maps with mode", () => {
    const r = rowToRecord(rewardLive());
    expect(r.startedAt).toBe(Date.parse(ST));
    expect(r.expiresAt).toBe(Date.parse(EX));
    expect(r.mode).toBe("reward");
  });
  test("in_progress requires valid started_at / expires_at", () => {
    expect(invalid(rewardLive({ started_at: null }))).toBe("invalid_row");
    expect(invalid(rewardLive({ expires_at: null }))).toBe("invalid_row");
    expect(invalid(legacy({ expires_at: null }))).toBe("invalid_row");
    expect(invalid(legacy({ started_at: "nope" }))).toBe("invalid_row");
    expect(invalid(legacy({ expires_at: "2027-01-15T08:01:16.000Z" }))).toBe("invalid_row");
  });
  test("reward in_progress requires ack_at equal to started_at", () => {
    expect(invalid(rewardLive({ ack_at: null }))).toBe("invalid_row");
    expect(invalid(rewardLive({ ack_at: "2027-01-15T08:00:06.000Z" }))).toBe("invalid_row");
  });
  test("completed reward needs completion fields", () => {
    expect(invalid(rewardLive({ status: "completed" }))).toBe("invalid_row");
    expect(rowToRecord(rewardLive({ status: "completed", completed_at: "2027-01-15T08:01:00.000Z", verified_score: 40, telemetry_hash: H })).status).toBe("completed");
  });
  test("non-zero discount still rejected", () => {
    expect(invalid(rewardLive({ awarded_discount_percent: "5.00" }))).toBe("invalid_row");
    expect(invalid(prepared({ awarded_discount_percent: 1 }))).toBe("invalid_row");
  });
});

describe("adapter: legacy rows unchanged", () => {
  test("legacy rows without mode column still map", () => {
    for (const status of ["in_progress", "expired", "rejected"]) {
      const r = rowToRecord(legacy({ status }));
      expect(r.status).toBe(status);
      expect(r.mode).toBeUndefined();
      expect(r.rulesVersion).toBe(1);
    }
    expect(rowToRecord(legacy({ status: "completed", completed_at: "2027-01-15T08:01:00.000Z", verified_score: 0, telemetry_hash: H })).verifiedScore).toBe(0);
  });
  test("explicit mode legacy accepted; legacy with v2 rejected", () => {
    expect(rowToRecord(legacy({ mode: "legacy" })).rulesVersion).toBe(1);
    expect(invalid(legacy({ rules_version: 2 }))).toBe("invalid_row");
    expect(invalid(legacy({ mode: "bogus" }))).toBe("invalid_row");
  });
});
