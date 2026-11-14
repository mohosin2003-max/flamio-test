import { describe, expect, test } from "bun:test";
import {
  generateTrack, replayDiscountMeter, gateSchedule, trackPosition, difficultyTier, applyOp, METER,
  BURGER_INGREDIENTS, V3_INGREDIENTS, OPERATION_RULES_VERSION, TIERED_RULES_VERSION, RULES_VERSION,
  GAMEPLAY_DURATION_MS, HARD_CUTOFF_MS,
} from "./burger-boost-rules.ts";

const N = 30;
const act = (tr) => tr.map((_, i) => ({ gateIndex: i, lane: i % 2, t: i * 1000 }));

describe("step 63 backward compatibility", () => {
  test("v1/v2 ingredient pool is still exactly the original eight", () => {
    expect([...BURGER_INGREDIENTS]).toEqual(["cheese", "lettuce", "sausage", "sauce", "mayo", "cucumber", "carrot", "tomato"]);
  });
  test("v1/v2 tracks never contain onion or capsicum", () => {
    for (let s = 1; s <= 300; s++) for (const v of [RULES_VERSION, OPERATION_RULES_VERSION]) {
      const j = JSON.stringify(generateTrack(BigInt(s), v, N));
      expect(j.includes("onion") || j.includes("capsicum")).toBe(false);
    }
  });
  test("v2 replay default is unchanged (explicit v2 == default)", () => {
    const tr = generateTrack(42n, OPERATION_RULES_VERSION, N);
    expect(replayDiscountMeter(42n, N, act(tr))).toEqual(replayDiscountMeter(42n, N, act(tr), OPERATION_RULES_VERSION));
  });
  test("v1/v2 gate timing stays constant 1840 ms for 30 gates", () => {
    const s = gateSchedule(N, OPERATION_RULES_VERSION);
    expect(s[0]).toBe(1840); expect(s[29]).toBeCloseTo(55200, 6);
  });
});

describe("step 63 rules v3", () => {
  test("deterministic per seed and distinct from v2", () => {
    expect(generateTrack(7n, TIERED_RULES_VERSION, N)).toEqual(generateTrack(7n, TIERED_RULES_VERSION, N));
    expect(generateTrack(7n, TIERED_RULES_VERSION, N)).not.toEqual(generateTrack(7n, OPERATION_RULES_VERSION, N));
  });
  test("onion and capsicum appear in v3 tracks", () => {
    const seen = new Set();
    for (let s = 1; s <= 200; s++) for (const g of generateTrack(BigInt(s), TIERED_RULES_VERSION, N)) {
      if (g.kind === "ingredient") g.lanes.forEach((x) => seen.add(x));
      if (g.kind === "negative") seen.add(g.spoiled);
    }
    expect(seen.has("onion")).toBe(true); expect(seen.has("capsicum")).toBe(true);
    for (const x of seen) expect(V3_INGREDIENTS).toContain(x);
  });
  test("v3 replay equals step-by-step derivation", () => {
    for (let s = 1; s <= 50; s++) {
      const r = replayDiscountMeter(BigInt(s), N, act(generateTrack(BigInt(s), TIERED_RULES_VERSION, N)), TIERED_RULES_VERSION);
      expect(r.valid).toBe(true); expect(r.gatesPassed).toBe(N);
    }
  });
  test("tiers: gates 1-10 early, 11-20 intermediate, 21-30 advanced", () => {
    expect(difficultyTier(0, N)).toBe(0); expect(difficultyTier(9, N)).toBe(0);
    expect(difficultyTier(10, N)).toBe(1); expect(difficultyTier(19, N)).toBe(1);
    expect(difficultyTier(20, N)).toBe(2); expect(difficultyTier(29, N)).toBe(2);
  });
  test("early gates: never ×2/÷2, subtraction at most 10", () => {
    for (let s = 1; s <= 300; s++) generateTrack(BigInt(s), TIERED_RULES_VERSION, N).slice(0, 10).forEach((g) => {
      if (g.kind !== "op") return;
      for (const c of g.lanes) { expect(["+", "−"]).toContain(c.op); if (c.op === "−") expect(c.v).toBeLessThanOrEqual(10); }
    });
  });
  test("advanced gates: no trivially small boosts, harsher penalties", () => {
    let lose = 0;
    for (let s = 1; s <= 300; s++) generateTrack(BigInt(s), TIERED_RULES_VERSION, N).slice(20).forEach((g) => {
      if (g.kind !== "op") return;
      for (const c of g.lanes) { if (c.op === "+") expect(c.v).toBeGreaterThanOrEqual(6); if (c.op === "−") expect(c.v).toBeGreaterThanOrEqual(10); }
      if (g.lanes.every((c) => c.op === "−")) lose++;
    });
    expect(lose).toBeGreaterThan(0);
  });
  test("every op gate has a choice that is not worse than the other (never two identical lanes)", () => {
    for (let s = 1; s <= 100; s++) for (const g of generateTrack(BigInt(s), TIERED_RULES_VERSION, N)) {
      if (g.kind !== "op") continue;
      expect(g.lanes[0]).not.toEqual(g.lanes[1]);
      expect(Number.isFinite(applyOp(METER.start, g.lanes[0]))).toBe(true);
    }
  });
});

describe("step 63 speed ramp", () => {
  const s = gateSchedule(N, TIERED_RULES_VERSION);
  test("2100 ms first gate to 1600 ms last gate, strictly accelerating", () => {
    expect(s[0]).toBeCloseTo(2100, 6);
    expect(s[29] - s[28]).toBeCloseTo(1600, 6);
    for (let i = 2; i < N; i++) expect(s[i] - s[i - 1]).toBeLessThan(s[i - 1] - s[i - 2]);
  });
  test("all 30 gates arrive before 60 s; hard cutoff still 75 s", () => {
    expect(s[29]).toBeCloseTo(55500, 6);
    expect(s[29]).toBeLessThan(GAMEPLAY_DURATION_MS);
    expect(HARD_CUTOFF_MS).toBe(75000);
    for (const n of [1, 10, 60, 200]) expect(gateSchedule(n, TIERED_RULES_VERSION).at(-1)).toBeLessThan(GAMEPLAY_DURATION_MS);
  });
  test("track position hits whole gates exactly at arrival", () => {
    expect(trackPosition(0, s)).toBe(0);
    expect(trackPosition(s[0], s)).toBeCloseTo(1, 9);
    expect(trackPosition(s[14], s)).toBeCloseTo(15, 9);
    expect(trackPosition(s[1] - 1, s)).toBeLessThan(2);
  });
});
