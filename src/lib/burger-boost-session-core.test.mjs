import { describe, expect, test } from "bun:test";
import { generateTrack } from "./burger-boost-rules.ts";
import {
  createBurgerBoostSessionService, generateSeed, unsignedToInt8String, int8StringToUnsigned,
  canonicalTelemetry, sha256Hex, RULES_VERSION, GATE_COUNT, GAMEPLAY_WINDOW_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS,
} from "./burger-boost-session-core.ts";

function memRepo() {
  const rows = new Map();
  let writes = 0;
  return {
    rows, get writes() { return writes; },
    async insert(r) { rows.set(r.id, { ...r }); },
    async findForUser(id, userId) { const r = rows.get(id); return r && r.userId === userId ? { ...r } : null; },
    async completeIfInProgress(id, userId, u) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== "in_progress") return false;
      Object.assign(r, u, { status: "completed" }); writes++; return true;
    },
    async transitionIfInProgress(id, userId, status, at) {
      const r = rows.get(id);
      if (!r || r.userId !== userId || r.status !== "in_progress") return false;
      Object.assign(r, { status, completedAt: at }); writes++; return true;
    },
  };
}

const SEED = "-1234567890123456789";
function setup() {
  const repo = memRepo();
  let clock = 1_000_000; let n = 0;
  const svc = createBurgerBoostSessionService({ repo, now: () => clock, newId: () => `s${++n}`, seed: () => SEED });
  return { repo, svc, at: (ms) => { clock = ms; }, get clock() { return clock; } };
}
const track = generateTrack(int8StringToUnsigned(SEED), RULES_VERSION, GATE_COUNT);
const validActions = (k = 10) => track.slice(0, k).map((g, i) => ({ gateIndex: i, lane: g.kind === "negative" ? 1 - g.spoiledLane : 0, t: i * 1000 }));

describe("burger boost session core", () => {
  test("constants", () => {
    expect([RULES_VERSION, GATE_COUNT, GAMEPLAY_WINDOW_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS]).toEqual([1, 30, 60000, 15000, 75000]);
  });

  test("1. start: expiresAt = startedAt + 75s; DTO hides seed/score/discount/track", async () => {
    const { svc, repo } = setup();
    const dto = await svc.start("u1");
    expect(dto.expiresAt - dto.startedAt).toBe(75000);
    expect(dto.gameplayEndsAt - dto.startedAt).toBe(60000);
    expect(Object.keys(dto).sort()).toEqual(["expiresAt", "gameplayEndsAt", "gateCount", "rulesVersion", "sessionId", "startedAt", "status"]);
    expect(JSON.stringify(dto)).not.toContain(SEED);
    expect(repo.rows.get(dto.sessionId).awardedDiscountPercent).toBe(0);
  });

  test("2. valid replay completes with server hash", async () => {
    const { svc, repo, at, clock } = setup();
    const { sessionId } = await svc.start("u1"); at(clock + 30000);
    const res = await svc.submit(sessionId, "u1", { playerActions: validActions() });
    expect(res).toEqual({ ok: true, status: "completed" });
    expect(Object.keys(res)).not.toContain("score");
    const row = repo.rows.get(sessionId);
    expect(row.telemetryHash).toBe(await sha256Hex(canonicalTelemetry(validActions())));
    expect(row.awardedDiscountPercent).toBe(0);
  });

  for (const [label, delta, expected] of [["60,000ms accepted", 60000, "completed"], ["75,000ms accepted (grace)", 75000, "completed"], ["75,001ms expired", 75001, "expired"]]) {
    test(`3. ${label}`, async () => {
      const { svc, repo, at, clock } = setup();
      const { sessionId } = await svc.start("u1"); at(clock + delta);
      const res = await svc.submit(sessionId, "u1", { playerActions: validActions() });
      expect(res.status).toBe(expected);
      expect(repo.rows.get(sessionId).status).toBe(expected);
      if (expected === "expired") expect(repo.rows.get(sessionId).verifiedScore).toBeNull();
    });
  }

  test("4. future-dated session rejected safely, no mutation", async () => {
    const { svc, repo, at, clock } = setup();
    const { sessionId } = await svc.start("u1"); at(clock - 1);
    const res = await svc.submit(sessionId, "u1", { playerActions: validActions() });
    expect(res.status).toBe("clock_anomaly");
    expect(repo.rows.get(sessionId).status).toBe("in_progress");
    expect(repo.writes).toBe(0);
  });

  test("5. out-of-order actions rejected", async () => {
    const { svc, repo } = setup();
    const { sessionId } = await svc.start("u1");
    const a = validActions(); [a[0], a[1]] = [a[1], a[0]];
    expect((await svc.submit(sessionId, "u1", { playerActions: a })).status).toBe("rejected");
    expect(repo.rows.get(sessionId).status).toBe("rejected");
  });

  test("6. skipped and duplicate gates rejected", async () => {
    for (const mutate of [(a) => a.splice(3, 1), (a) => a.splice(3, 0, { ...a[3] })]) {
      const { svc } = setup(); const { sessionId } = await svc.start("u1");
      const a = validActions(); mutate(a);
      expect((await svc.submit(sessionId, "u1", { playerActions: a })).status).toBe("rejected");
    }
  });

  test("7. actions array is not sorted or mutated", async () => {
    const { svc } = setup(); const { sessionId } = await svc.start("u1");
    const a = validActions(); const snap = JSON.stringify(a);
    await svc.submit(sessionId, "u1", { playerActions: a });
    expect(JSON.stringify(a)).toBe(snap);
  });

  test("8. hash deterministic and order-sensitive", async () => {
    const a = validActions(); const b = [...a].reverse();
    expect(await sha256Hex(canonicalTelemetry(a))).toBe(await sha256Hex(canonicalTelemetry(a)));
    expect(await sha256Hex(canonicalTelemetry(a))).not.toBe(await sha256Hex(canonicalTelemetry(b)));
    expect(canonicalTelemetry(a.slice(0, 1))).toBe("[[0,0,0]]".replace("0,0,0", `0,${a[0].lane},0`));
  });

  test("9. client score/seed/discount/telemetryHash ignored", async () => {
    const { svc, repo } = setup(); const { sessionId } = await svc.start("u1");
    await svc.submit(sessionId, "u1", { playerActions: validActions(), score: 99999, seed: "1", awardedDiscountPercent: 50, telemetryHash: "deadbeef" });
    const row = repo.rows.get(sessionId);
    expect(row.verifiedScore).not.toBe(99999);
    expect(row.telemetryHash).not.toBe("deadbeef");
    expect(row.seed).toBe(SEED);
    expect(row.awardedDiscountPercent).toBe(0);
  });

  test("10. failed replay stores neither score nor hash", async () => {
    const { svc, repo } = setup(); const { sessionId } = await svc.start("u1");
    await svc.submit(sessionId, "u1", { playerActions: [{ gateIndex: 0, lane: 7, t: 0 }] });
    const row = repo.rows.get(sessionId);
    expect([row.status, row.verifiedScore, row.telemetryHash]).toEqual(["rejected", null, null]);
  });

  test("11. malformed payload rejected", async () => {
    const { svc } = setup(); const { sessionId } = await svc.start("u1");
    expect((await svc.submit(sessionId, "u1", "garbage")).status).toBe("rejected");
  });

  test("12. rejected session cannot later complete", async () => {
    const { svc, repo } = setup(); const { sessionId } = await svc.start("u1");
    await svc.submit(sessionId, "u1", { playerActions: "x" });
    const res = await svc.submit(sessionId, "u1", { playerActions: validActions() });
    expect(res.ok).toBe(false);
    expect(repo.rows.get(sessionId).status).toBe("rejected");
  });

  test("13. wrong-user invalid replay cannot mutate victim session", async () => {
    const { svc, repo } = setup(); const { sessionId } = await svc.start("victim");
    const before = JSON.stringify(repo.rows.get(sessionId));
    expect((await svc.submit(sessionId, "attacker", { playerActions: "bad" })).status).toBe("not_found");
    expect((await svc.submit(sessionId, "attacker", { playerActions: validActions() })).status).toBe("not_found");
    expect(await repo.transitionIfInProgress(sessionId, "attacker", "rejected", 1)).toBe(false);
    expect(JSON.stringify(repo.rows.get(sessionId))).toBe(before);
    expect(await svc.get(sessionId, "attacker")).toBeNull();
  });

  test("14. concurrent completion: exactly one succeeds", async () => {
    const { svc, repo } = setup(); const { sessionId } = await svc.start("u1");
    const results = await Promise.all(Array.from({ length: 8 }, () => svc.submit(sessionId, "u1", { playerActions: validActions() })));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(repo.writes).toBe(1);
  });

  test("15. seed int8 edge round-trips exactly", () => {
    for (const u of [0n, 1n, (1n << 63n) - 1n, 1n << 63n, (1n << 64n) - 1n, 0x9e3779b97f4a7c15n]) {
      const s = unsignedToInt8String(u);
      expect(int8StringToUnsigned(s)).toBe(u);
    }
    expect(unsignedToInt8String((1n << 64n) - 1n)).toBe("-1");
    expect(unsignedToInt8String(1n << 63n)).toBe("-9223372036854775808");
    expect(() => int8StringToUnsigned("9223372036854775808")).toThrow();
    expect(() => int8StringToUnsigned("1.5")).toThrow();
  });

  test("16. generateSeed is secure-random int8 string", () => {
    const seen = new Set(Array.from({ length: 50 }, generateSeed));
    expect(seen.size).toBe(50);
    for (const s of seen) { expect(s).toMatch(/^-?\d+$/); expect(unsignedToInt8String(int8StringToUnsigned(s))).toBe(s); }
  });

  test("17. get returns DTO for owner only, no secrets", async () => {
    const { svc } = setup(); const { sessionId } = await svc.start("u1");
    const dto = await svc.get(sessionId, "u1");
    expect(dto.status).toBe("in_progress");
    expect(JSON.stringify(dto)).not.toMatch(/seed|score|discount|track/i);
  });
});
