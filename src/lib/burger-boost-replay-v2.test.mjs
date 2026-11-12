import { describe, expect, test } from "bun:test";
import {
  generateTrack, replayDiscountMeter, simulateBurgerBoostReplay, stepMeter, applyOp,
  METER, OPERATION_RULES_VERSION, RULES_VERSION, HARD_CUTOFF_MS,
} from "./burger-boost-rules.ts";

const SEED = 987654321098765n;
const N = 30;
const track = generateTrack(SEED, OPERATION_RULES_VERSION, N);
const act = (lanes) => lanes.map((lane, i) => ({ gateIndex: i, lane, t: i * 1000 }));
const manual = (tr, lanes) => lanes.reduce((m, l, i) => stepMeter(m, tr[i], l), METER.start);

describe("replay v2 determinism", () => {
  test("version constants distinct", () => expect(OPERATION_RULES_VERSION).not.toBe(RULES_VERSION));
  test("gate sequence deterministic per seed", () => {
    expect(generateTrack(SEED, OPERATION_RULES_VERSION, N)).toEqual(track);
    expect(generateTrack(SEED + 1n, OPERATION_RULES_VERSION, N)).not.toEqual(track);
  });
  test("same seed + actions → identical result, twice", () => {
    const a = act(track.map((_, i) => i % 2));
    const r1 = replayDiscountMeter(SEED, N, a), r2 = replayDiscountMeter(SEED, N, a);
    expect(r1.valid).toBe(true);
    expect(r1).toEqual(r2);
  });
  test("v2 tracks contain only op/ingredient/negative gates, first is op", () => {
    expect(track[0].kind).toBe("op");
    for (const g of track) expect(["op", "ingredient", "negative"]).toContain(g.kind);
  });
});

describe("replay v2 authoritative calculation", () => {
  test("final meter equals step-by-step derivation", () => {
    for (let s = 1; s <= 50; s++) {
      const tr = generateTrack(BigInt(s), OPERATION_RULES_VERSION, N);
      const lanes = tr.map((_, i) => (s * 7 + i) % 2);
      const r = replayDiscountMeter(BigInt(s), N, act(lanes));
      expect(r.valid).toBe(true);
      expect(r.finalMeter).toBe(manual(tr, lanes));
      expect(r.gatesPassed).toBe(N);
    }
  });
  test("forged score/meter/discount fields are rejected, never trusted", () => {
    for (const extra of [{ score: 9999 }, { meter: 100 }, { discount: 50 }, { finalMeter: 100 }]) {
      const r = replayDiscountMeter(SEED, N, [{ gateIndex: 0, lane: 0, t: 0, ...extra }]);
      expect(r).toMatchObject({ valid: false, finalMeter: 0, error: "malformed action" });
    }
  });
  test("forged result cannot change outcome of the same lanes", () => {
    const lanes = track.map(() => 0);
    const honest = replayDiscountMeter(SEED, N, act(lanes)).finalMeter;
    const r = replayDiscountMeter(SEED, N, act(lanes));
    expect(r.finalMeter).toBe(honest);
  });
});

describe("replay v2 action integrity", () => {
  const err = (p, g = N) => replayDiscountMeter(SEED, g, p).error;
  test("invalid gate index", () => {
    expect(err([{ gateIndex: -1, lane: 0, t: 0 }])).toBe("invalid gate index");
    expect(err([{ gateIndex: N, lane: 0, t: 0 }])).toBe("invalid gate index");
    expect(err([{ gateIndex: 0.5, lane: 0, t: 0 }])).toBe("invalid gate index");
  });
  test("missing / duplicated / out-of-order", () => {
    expect(err([{ gateIndex: 1, lane: 0, t: 0 }])).toBe("impossible gate progression");
    expect(err([{ gateIndex: 0, lane: 0, t: 0 }, { gateIndex: 0, lane: 0, t: 1 }])).toBe("impossible gate progression");
    expect(err([{ gateIndex: 0, lane: 0, t: 0 }, { gateIndex: 2, lane: 0, t: 1 }])).toBe("impossible gate progression");
  });
  test("beyond gate sequence", () => {
    expect(err(act(Array(N + 1).fill(0)))).toBe("too many actions");
  });
  test("invalid lane", () => {
    for (const lane of [-1, 2, 0.5, "0", null]) expect(err([{ gateIndex: 0, lane, t: 0 }])).toBe("invalid lane");
  });
  test("invalid timing", () => {
    expect(err([{ gateIndex: 0, lane: 0, t: -1 }])).toBe("malformed timing");
    expect(err([{ gateIndex: 0, lane: 0, t: HARD_CUTOFF_MS + 1 }])).toBe("malformed timing");
    expect(err([{ gateIndex: 0, lane: 0, t: 1.5 }])).toBe("malformed timing");
    expect(err([{ gateIndex: 0, lane: 0, t: 500 }, { gateIndex: 1, lane: 0, t: 100 }])).toBe("malformed timing");
    expect(replayDiscountMeter(SEED, N, [{ gateIndex: 0, lane: 0, t: HARD_CUTOFF_MS }]).valid).toBe(true);
  });
  test("malformed payload", () => {
    for (const p of [null, undefined, "x", 5, {}]) expect(err(p)).toBe("malformed actions");
    for (const p of [[null], ["a"], [{ gateIndex: 0, lane: 0 }], [{ gateIndex: "0", lane: 0, t: 0 }]])
      expect(replayDiscountMeter(SEED, N, p).valid).toBe(false);
    expect(replayDiscountMeter(SEED, 1000, []).valid).toBe(false);
  });
  test("invalid operation choice rejected by applyOp", () => {
    expect(() => applyOp(0, { op: "%", v: 2 })).toThrow();
    expect(() => applyOp(0, { op: "+", v: 0 })).toThrow();
    expect(() => applyOp(0, { op: "+", v: 1.5 })).toThrow();
    expect(() => applyOp(0.5, { op: "+", v: 1 })).toThrow();
  });
  test("v1 math gates are not valid in v2 stepMeter", () => {
    expect(() => stepMeter(0, { kind: "math", a: 1, op: "+", b: 1, lanes: [2, 3], correctLane: 0 }, 0)).toThrow();
  });
});

describe("replay v2 arithmetic", () => {
  const tracks = Array.from({ length: 200 }, (_, s) => generateTrack(BigInt(s + 1), OPERATION_RULES_VERSION, 60));
  test("division never by zero or one; all op values integers", () => {
    for (const tr of tracks) for (const g of tr) if (g.kind === "op") for (const c of g.lanes) {
      expect(Number.isInteger(c.v)).toBe(true);
      if (c.op === "÷") expect(c.v).toBeGreaterThanOrEqual(2);
    }
    expect(() => applyOp(10, { op: "÷", v: 1 })).toThrow();
  });
  test("×2 appears at most twice per track", () => {
    for (const tr of tracks) {
      const n = tr.filter((g) => g.kind === "op" && g.lanes.some((c) => c.op === "×")).length;
      expect(n).toBeLessThanOrEqual(METER.maxMultipliers);
    }
  });
  test("integer division truncates toward zero", () => {
    expect(applyOp(7, { op: "÷", v: 2 })).toBe(3);
    expect(applyOp(-7, { op: "÷", v: 2 })).toBe(-3);
  });
  test("negative meter preserved, recovery works, bounds clamp", () => {
    expect(applyOp(0, { op: "−", v: 20 })).toBe(-20);
    expect(applyOp(-20, { op: "+", v: 12 })).toBe(-8);
    expect(applyOp(-95, { op: "−", v: 20 })).toBe(METER.min);
    expect(applyOp(150, { op: "×", v: 2 })).toBe(METER.max);
    const hz = { kind: "negative", spoiled: "cheese", spoiledLane: 1 };
    expect(stepMeter(-95, hz, 1)).toBe(METER.min);
    expect(stepMeter(5, hz, 0)).toBe(5);
    expect(stepMeter(5, hz, 1)).toBe(5 + METER.hazard);
    expect(stepMeter(METER.max, { kind: "ingredient", lanes: ["cheese", "patty"] }, 0)).toBe(METER.max);
  });
  test("every replayed meter is an integer within bounds", () => {
    for (let s = 1; s <= 200; s++) {
      const tr = tracks[s - 1];
      const r = replayDiscountMeter(BigInt(s), 60, act(tr.map((_, i) => (i * s) % 2)));
      expect(Number.isInteger(r.finalMeter)).toBe(true);
      expect(r.finalMeter).toBeGreaterThanOrEqual(METER.min);
      expect(r.finalMeter).toBeLessThanOrEqual(METER.max);
      expect(r.peakMeter).toBeGreaterThanOrEqual(r.finalMeter);
    }
  });
});

describe("version isolation", () => {
  test("v1 replay rejects v2 sessions", () => {
    expect(simulateBurgerBoostReplay(SEED, N, act([0]), OPERATION_RULES_VERSION)).toMatchObject({ valid: false, error: "unsupported rules version" });
  });
  test("v2 replay independent of v1 track", () => {
    expect(generateTrack(SEED, RULES_VERSION, N)).not.toEqual(track);
    expect(replayDiscountMeter(SEED, N, act([0])).valid).toBe(true);
  });
});
