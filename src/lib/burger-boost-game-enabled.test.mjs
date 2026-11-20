import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { gameEnabledArgs, parseOwnerRewardSettings, setGameEnabledAsOwner } from "./burger-boost-settings.ts";
import { RELEASE_LOCKS } from "./burger-boost-reward-flow.ts";

const row = (game_enabled) => ({
  game_enabled, owner_max_discount: 0, partial_max_discount: 0, daily_full_limit: 0,
  daily_partial_limit: 0, min_order_bdt: 0, gate_count: 30, claim_expiry_minutes: 30,
  dhaka_date: "2026-11-20", full_used: 0, full_reserved: 0, partial_used: 0, partial_reserved: 0,
});
function fake(roles, before = row(false)) {
  const calls = [];
  let loaded = 0;
  const transport = { schema: (s) => ({ rpc: async (name, args) => {
    calls.push({ s, name, args });
    return { data: { ...before, game_enabled: args.p_enabled }, error: null };
  } }) };
  return { calls, loadedCount: () => loaded, deps: (enabled) => ({
    args: gameEnabledArgs({ enabled }),
    loadRoles: async () => roles,
    loadTransport: async () => { loaded++; return transport; },
  }) };
}

describe("owner game on/off", () => {
  test("owner calls set_game_enabled once with exact boolean", async () => {
    const f = fake({ data: [{ role: "owner" }], error: null });
    const r = await setGameEnabledAsOwner(f.deps(false));
    expect(f.calls).toEqual([{ s: "burger_boost", name: "set_game_enabled", args: { p_enabled: false } }]);
    expect(r.gameEnabled).toBe(false);
  });
  for (const roles of [[{ role: "staff" }], [{ role: "manager" }], [{ role: "customer" }], []]) {
    test(`non-owner ${JSON.stringify(roles)} is rejected before transport loads`, async () => {
      const f = fake({ data: roles, error: null });
      await expect(setGameEnabledAsOwner(f.deps(false))).rejects.toThrow("Forbidden");
      expect(f.loadedCount()).toBe(0);
      expect(f.calls.length).toBe(0);
    });
  }
  test("role lookup error fails closed", async () => {
    const f = fake({ data: null, error: { message: "x" } });
    await expect(setGameEnabledAsOwner(f.deps(false))).rejects.toThrow("Unable to verify");
    expect(f.calls.length).toBe(0);
  });
  test("unauthenticated callers are blocked by auth middleware", () => {
    const src = readFileSync(new URL("./burger-boost-owner.functions.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("setBurgerBoostGameEnabled"));
    expect(block).toContain("middleware([requireSupabaseAuth])");
    expect(block).toContain('.eq("user_id", context.userId)');
    expect(src).not.toMatch(/^import .*client\.server/m);
  });
  test("input must be exactly { enabled: boolean }", () => {
    for (const bad of [{ enabled: "true" }, null, { enabled: null }, { enabled: true, role: "owner" }, [true]])
      expect(() => gameEnabledArgs(bad)).toThrow();
    expect(gameEnabledArgs({ enabled: true })).toEqual({ p_enabled: true });
  });
  test("game_enabled parses strictly; other settings unchanged", () => {
    expect(parseOwnerRewardSettings(row("true")).gameEnabled).toBe(false);
    const a = parseOwnerRewardSettings(row(false));
    const b = parseOwnerRewardSettings(row(true));
    expect(b.settings).toEqual(a.settings);
    expect(b.settings.gateCount).toBe(30);
    expect(b.settings.ownerMax).toBe(0);
  });
  test("release locks stay off", () => {
    expect(RELEASE_LOCKS.checkout).toBe(false);
    expect(RELEASE_LOCKS.couponIssuance).toBe(false);
  });
  test("migration only touches game_enabled/updated_at and no locks", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261121004000_bb_set_game_enabled_rpc.sql", import.meta.url), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/DROP CONSTRAINT|bb_sessions_discount_locked|bb_coupons_phase1_locked|game_enabled\s*=\s*true/i);
    expect(code).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
    expect(code).toMatch(/SET game_enabled = p_enabled,\s*updated_at = pg_catalog\.now\(\)\s*WHERE/);
  });
});
