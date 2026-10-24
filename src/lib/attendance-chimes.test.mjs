import { describe, expect, test } from "bun:test";
import { CHIME_MUTE_KEY, isChimeMuted, playChime, setChimeMuted } from "./attendance-chimes.ts";

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
class FakeAudio { constructor() { this.currentTime = 0; this.destination = {}; FakeAudio.oscs = 0; }
  createOscillator() { FakeAudio.oscs++; return { frequency: {}, connect() {}, start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  close() { return Promise.resolve(); } }

describe("attendance chimes", () => {
  test("mute preference persists", () => {
    const s = mem(); expect(isChimeMuted(s)).toBe(false);
    setChimeMuted(s, true); expect(s.getItem(CHIME_MUTE_KEY)).toBe("1"); expect(isChimeMuted(s)).toBe(true);
    setChimeMuted(s, false); expect(isChimeMuted(s)).toBe(false);
  });
  test("muted plays nothing", () => {
    const s = mem(); setChimeMuted(s, true);
    expect(playChime("clock_in", { store: s, Audio: FakeAudio })).toBe(false);
  });
  test("unmuted schedules the clock-in tones", () => {
    expect(playChime("clock_in", { store: mem(), Audio: FakeAudio })).toBe(true);
    expect(FakeAudio.oscs).toBe(2);
  });
  test("no audio support fails safe", () => {
    expect(playChime("warning", { store: mem(), Audio: null })).toBe(false);
  });
  test("throwing audio or storage never throws", () => {
    class Boom { constructor() { throw new Error("blocked"); } }
    const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
    expect(() => setChimeMuted(bad, true)).not.toThrow();
    expect(playChime("clock_out", { store: bad, Audio: Boom })).toBe(false);
  });
});
