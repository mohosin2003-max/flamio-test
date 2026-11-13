import { describe, expect, test } from "bun:test";
import { victoryPose, isLossResult, VICTORY_MS } from "./burger-boost-victory.ts";

describe("victory animation timeline", () => {
  test("starts holding proudly, burger low, no bite", () => {
    const p = victoryPose(0);
    expect(p.phase).toBe("hold"); expect(p.appear).toBe(0); expect(p.lift).toBe(0); expect(p.bites).toBe(0); expect(p.done).toBe(false);
  });
  test("raise phase lifts the burger toward the face", () => {
    expect(victoryPose(650).phase).toBe("raise");
    expect(victoryPose(900).lift).toBeGreaterThan(victoryPose(500).lift);
  });
  test("bite phase opens the mouth, moves burger to mouth and leaves a bite", () => {
    const p = victoryPose(1175);
    expect(p.phase).toBe("bite"); expect(p.mouthOpen).toBeGreaterThan(0.9); expect(p.lift).toBeGreaterThan(0.9); expect(p.bites).toBe(1);
    expect(victoryPose(1449).mouthOpen).toBeLessThan(0.05);
  });
  test("chew phase bobs the jaw and keeps the bite", () => {
    const vals = [1500, 1560, 1620, 1700].map((t) => victoryPose(t));
    expect(vals.every((v) => v.phase === "chew" && v.bites === 1 && v.mouthOpen === 0)).toBe(true);
    expect(Math.max(...vals.map((v) => Math.abs(v.chew)))).toBeGreaterThan(0.3);
  });
  test("final pose: celebrating, burger lowered, done, clamps past end", () => {
    const p = victoryPose(VICTORY_MS);
    expect(p.phase).toBe("final"); expect(p.cheer).toBe(1); expect(p.done).toBe(true); expect(p.lift).toBeLessThan(0.3); expect(p.chew).toBe(0);
    expect(victoryPose(99999)).toEqual(p);
    expect(victoryPose(-50)).toEqual(victoryPose(0));
  });
  test("loss: sad, head lowered, no bite, no cheer", () => {
    const p = victoryPose(VICTORY_MS, true);
    expect(p.sad).toBe(true); expect(p.headDrop).toBe(1); expect(p.bites).toBe(0); expect(p.cheer).toBe(0); expect(p.lift).toBe(0);
    expect(victoryPose(VICTORY_MS).sad).toBe(false);
  });
  test("deterministic at the same elapsed time", () => {
    for (const t of [0, 333, 1234, 1777, 2600]) expect(victoryPose(t)).toEqual(victoryPose(t));
  });
  test("loss classification uses existing meter <= 0 rule", () => {
    expect(isLossResult(0)).toBe(true); expect(isLossResult(-5)).toBe(true); expect(isLossResult(1)).toBe(false);
  });
});
