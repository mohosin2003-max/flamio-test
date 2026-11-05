import { describe, expect, test } from "bun:test";
import {
  generateTrack, simulateBurgerBoostReplay, RULES_VERSION, GAMEPLAY_DURATION_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS,
} from "./burger-boost-rules.ts";

const SEED = 123456789012345n;
const N = 40;
const track = generateTrack(SEED, RULES_VERSION, N);
const act = (lanes) => lanes.map((lane, i) => ({ gateIndex: i, lane, t: i * 1000 }));
const idx = (kind) => track.findIndex((g) => g.kind === kind);

describe("burger boost pure engine", () => {
  test("timing constants 60/15/75", () => {
    expect([GAMEPLAY_DURATION_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS]).toEqual([60000, 15000, 75000]);
  });
  test("1. same seed → identical track", () => expect(generateTrack(SEED, 1, N)).toEqual(track));
  test("2. different seeds differ", () => expect(generateTrack(SEED + 1n, 1, N)).not.toEqual(track));
  test("3. same seed + actions → identical replay", () => {
    const a = act(track.map(() => 0));
    expect(simulateBurgerBoostReplay(SEED, N, a)).toEqual(simulateBurgerBoostReplay(SEED, N, a));
  });
  test("4/5. correct math lane counted, wrong lane penalised", () => {
    const m = idx("math");
    const lanes = track.slice(0, m + 1).map((g) => (g.kind === "negative" ? 1 - g.spoiledLane : 0));
    lanes[m] = track[m].correctLane;
    const ok = simulateBurgerBoostReplay(SEED, N, act(lanes));
    lanes[m] = 1 - track[m].correctLane;
    const bad = simulateBurgerBoostReplay(SEED, N, act(lanes));
    expect(ok.mathCorrect - bad.mathCorrect).toBe(1);
    expect(bad.mathWrong - ok.mathWrong).toBe(1);
    expect(ok.score - bad.score).toBe(10);
  });
  test("math answers are exact integers", () => {
    for (const g of track.filter((g) => g.kind === "math")) {
      const ans = { "+": g.a + g.b, "−": g.a - g.b, "×": g.a * g.b, "÷": g.a / g.b }[g.op];
      expect(Number.isInteger(ans)).toBe(true);
      expect(g.lanes[g.correctLane]).toBe(ans);
      expect(g.lanes[1 - g.correctLane]).not.toBe(ans);
    }
  });
  test("6. ingredient selection recorded", () => {
    const i = idx("ingredient");
    const lanes = track.slice(0, i + 1).map(() => 1);
    const r = simulateBurgerBoostReplay(SEED, N, act(lanes));
    expect(r.ingredients.at(-1)).toBe(track[i].lanes[1]);
  });
  test("7. spoiled gate deterministic", () => {
    const i = idx("negative");
    const lanes = track.slice(0, i + 1).map(() => 0);
    lanes[i] = track[i].spoiledLane;
    const a = simulateBurgerBoostReplay(SEED, N, act(lanes));
    expect(a).toEqual(simulateBurgerBoostReplay(SEED, N, act(lanes)));
    lanes[i] = 1 - track[i].spoiledLane;
    expect(a.spoiledHits - simulateBurgerBoostReplay(SEED, N, act(lanes)).spoiledHits).toBe(1);
  });
  test("8. invalid gate index rejected", () => {
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: N, lane: 0, t: 0 }]).error).toBe("invalid gate index");
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 1, lane: 0, t: 0 }]).error).toBe("impossible gate progression");
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 0, t: 0 }, { gateIndex: 0, lane: 0, t: 1 }]).error).toBe("impossible gate progression");
  });
  test("9. invalid lane rejected", () => {
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 2, t: 0 }]).error).toBe("invalid lane");
  });
  test("10. forged client score ignored", () => {
    const r = simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 0, t: 0, score: 99999 }]);
    expect(r.valid).toBe(false);
    expect(r.score).toBe(0);
  });
  test("11. malformed payload rejected", () => {
    for (const p of [null, "x", {}, [null], [{ gateIndex: "0", lane: 0, t: 0 }], [{ gateIndex: 0, lane: 0 }]])
      expect(simulateBurgerBoostReplay(SEED, N, p).valid).toBe(false);
    expect(simulateBurgerBoostReplay(SEED, N + 300, []).valid).toBe(false);
    expect(simulateBurgerBoostReplay(SEED, N, [], 2).valid).toBe(false);
  });
  test("12. client timestamps are never authoritative", () => {
    const r = simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 0, t: 1 }]);
    expect(r.timingAuthoritative).toBe(false);
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 0, t: 75001 }]).valid).toBe(false);
    expect(simulateBurgerBoostReplay(SEED, N, [{ gateIndex: 0, lane: 0, t: 500 }, { gateIndex: 1, lane: 0, t: 100 }]).valid).toBe(false);
  });
});
