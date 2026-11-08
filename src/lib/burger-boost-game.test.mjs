import { describe, expect, test } from "bun:test";
import {
  createGame, passGate, switchLane, phaseAt, stackPercent, inTargetRange, mathAnswer, replayScore,
  normalizeGateCount, STACK_TARGET_MIN, STACK_TARGET_MAX, AWARDED_DISCOUNT_PERCENT,
} from "./burger-boost-game.ts";

const SEED = 987654321n;

describe("burger boost practice game", () => {
  test("default 30 gates; dynamic valid counts; invalid falls back", () => {
    expect(createGame(SEED).track.length).toBe(30);
    expect(createGame(SEED, 12).track.length).toBe(12);
    expect(createGame(SEED, 50).gateCount).toBe(50);
    expect(normalizeGateCount(0)).toBe(30);
    expect(normalizeGateCount(2.5)).toBe(30);
    expect(normalizeGateCount(999)).toBe(30);
  });

  test("math operations and invalid division", () => {
    expect(mathAnswer(3, "+", 4)).toBe(7);
    expect(mathAnswer(9, "−", 4)).toBe(5);
    expect(mathAnswer(3, "×", 4)).toBe(12);
    expect(mathAnswer(12, "÷", 4)).toBe(3);
    expect(mathAnswer(5, "÷", 0)).toBeNull();
    expect(mathAnswer(7, "÷", 2)).toBeNull();
  });

  test("generated math gates offer correct answer in correctLane", () => {
    for (const g of createGame(SEED, 100).track) {
      if (g.kind === "math") expect(g.lanes[g.correctLane]).toBe(mathAnswer(g.a, g.op, g.b));
    }
  });

  test("lane switching and gate collisions match server replay", () => {
    let s = createGame(SEED, 40);
    for (let i = 0; i < 40; i++) {
      const g = s.track[i];
      const lane = g.kind === "math" ? g.correctLane : g.kind === "negative" ? 1 - g.spoiledLane : 0;
      s = switchLane(s, lane);
      expect(s.lane).toBe(lane);
      s = passGate(s, i * 1000).state;
    }
    expect(s.phase).toBe("finished");
    expect(s.spoiledHits).toBe(0);
    expect(s.mathWrong).toBe(0);
    expect(replayScore(SEED, s)).toBe(s.score);
  });

  test("ingredient adds layer; spoiled removes one", () => {
    let s = createGame(SEED, 100);
    const ing = s.track.findIndex((g) => g.kind === "ingredient");
    const neg = s.track.findIndex((g, i) => i > ing && g.kind === "negative");
    for (let i = 0; i < neg; i++) {
      const g = s.track[i];
      if (g.kind === "negative") s = switchLane(s, 1 - g.spoiledLane);
      s = passGate(s, i).state;
    }
    const before = s.layers.length;
    expect(before).toBeGreaterThan(0);
    s = switchLane(s, s.track[neg].spoiledLane);
    const r = passGate(s, neg);
    expect(r.outcome).toBe("spoiled");
    expect(r.state.layers.length).toBe(before - 1);
  });

  test("stack meter boundaries 34–66", () => {
    expect([STACK_TARGET_MIN, STACK_TARGET_MAX]).toEqual([34, 66]);
    expect(inTargetRange(33)).toBe(false);
    expect(inTargetRange(34)).toBe(true);
    expect(inTargetRange(66)).toBe(true);
    expect(inTargetRange(67)).toBe(false);
    const track = [{ kind: "ingredient" }, { kind: "ingredient" }, { kind: "math" }];
    expect(stackPercent({ track, layers: ["cheese"] })).toBe(50);
    expect(stackPercent({ track, layers: ["a", "b", "c"] })).toBe(100);
  });

  test("60 s gameplay, grace to 75 s, hard cutoff", () => {
    expect(phaseAt(59_999)).toBe("running");
    expect(phaseAt(60_000)).toBe("grace");
    expect(phaseAt(74_999)).toBe("grace");
    expect(phaseAt(75_000)).toBe("expired");
    const s = createGame(SEED);
    const r = passGate(s, 80_000);
    expect(r.state.phase).toBe("expired");
    expect(r.state.actions.length).toBe(0);
    expect(switchLane(r.state, 1)).toBe(r.state);
  });

  test("timestamps never decrease and discount stays 0", () => {
    let s = createGame(SEED);
    s = passGate(s, 5000).state;
    s = passGate(s, 1000).state;
    expect(s.actions[1].t).toBe(5000);
    expect(AWARDED_DISCOUNT_PERCENT).toBe(0);
  });
});
