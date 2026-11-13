import { describe, expect, test } from "bun:test";
import { createPauseClock, storeDiscountPreview, boostDelta } from "./burger-boost-pause.ts";
import { createGame, passGate, practiceSeed } from "./burger-boost-game.ts";
import { OPERATION_RULES_VERSION } from "./burger-boost-rules.ts";

describe("pause clock", () => {
  test("pause freezes elapsed gameplay time", () => {
    const c = createPauseClock(1000);
    expect(c.elapsed(6000)).toBe(5000);
    c.pause(6000);
    expect(c.elapsed(20000)).toBe(5000);
    expect(c.paused).toBe(true);
  });
  test("resume continues from the paused point without jumping", () => {
    const c = createPauseClock(0);
    c.pause(10000); c.resume(40000);
    expect(c.elapsed(40000)).toBe(10000);
    expect(c.elapsed(41000)).toBe(11000);
  });
  test("repeated pause/resume never accumulates wrong time", () => {
    const c = createPauseClock(0);
    for (let i = 0; i < 5; i++) { c.pause(i * 3000 + 1000); c.pause(i * 3000 + 1500); c.resume(i * 3000 + 3000); c.resume(i * 3000 + 3000); }
    // 5 cycles × 1000 ms of play
    expect(c.elapsed(15000)).toBe(5000);
  });
  test("paused clock prevents gate resolution (no gate becomes due)", () => {
    const interval = 1840;
    const c = createPauseClock(0);
    const s = createGame(practiceSeed(), 30, OPERATION_RULES_VERSION);
    c.pause(interval * 0.5);
    const due = (el) => (s.nextGate + 1) * interval <= el;
    expect(due(c.elapsed(interval * 10))).toBe(false);
    c.resume(interval * 10);
    expect(due(c.elapsed(interval * 10.6))).toBe(true);
    expect(passGate(s, c.elapsed(interval * 10.6)).state.nextGate).toBe(1);
  });
});

describe("store discount preview", () => {
  test("bounded by owner max, same clamp as reward calc", () => {
    expect([-20, 0, 50, 100, 120, 180].map((m) => storeDiscountPreview(20, m))).toEqual([0, 0, 10, 20, 20, 20]);
    expect(storeDiscountPreview(0, 180)).toBe(0);
  });
  test("boost feedback labels", () => {
    expect(boostDelta(12)).toBe("+12 BOOST");
    expect(boostDelta(-15)).toBe("−15 BOOST");
  });
});
