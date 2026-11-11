import { describe, expect, test } from "bun:test";
import { createAudioEngine, pickGateSound, MAX_VOICES } from "./burger-boost-audio";

function fakeCtx() {
  let created = 0;
  const ctx: any = {
    state: "running", currentTime: 0, destination: {}, closed: false,
    resume: async () => { ctx.state = "running"; }, suspend: async () => { ctx.state = "suspended"; },
    close: async () => { ctx.closed = true; },
    createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
    createOscillator: () => { created++; return { type: "", frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }; },
  };
  return { ctx, count: () => created };
}

describe("burger boost audio", () => {
  test("no context until unlock, one context reused", () => {
    let n = 0; const f = fakeCtx();
    const e = createAudioEngine(() => { n++; return f.ctx; });
    e.play("start"); expect(n).toBe(0); expect(f.count()).toBe(0);
    e.unlock(); e.unlock(); expect(n).toBe(1);
    e.play("start"); expect(f.count()).toBe(3);
  });
  test("unsupported context is silent and never throws", () => {
    const e = createAudioEngine(() => null);
    e.unlock(); e.play("victory"); expect(e.hasContext()).toBe(false);
    const t = createAudioEngine(() => { throw new Error("x"); });
    expect(() => { t.unlock(); t.play("gate"); }).not.toThrow();
  });
  test("mute stops voices and blocks playback", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    e.play("victory"); expect(e.activeVoices()).toBe(4);
    e.setMuted(true); expect(e.activeVoices()).toBe(0);
    e.play("start"); expect(e.activeVoices()).toBe(0);
    e.setMuted(false); e.play("lane"); expect(e.activeVoices()).toBe(1);
  });
  test("voices are bounded", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    for (let i = 0; i < 20; i++) e.play("victory");
    expect(e.activeVoices()).toBe(MAX_VOICES);
  });
  test("hold silences until unlocked again", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    e.hold(); e.play("gate"); expect(e.activeVoices()).toBe(0);
    e.unlock(); e.play("gate"); expect(e.activeVoices()).toBe(1);
  });
  test("dispose closes context and later plays are no-ops", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    e.dispose(); expect(f.ctx.closed).toBe(true);
    e.unlock(); e.play("victory"); expect(e.hasContext()).toBe(false);
  });
  test("multiple gates in one frame produce one sound", () => {
    expect(pickGateSound(["collect", "gate", "hazard"])).toBe("hazard");
    expect(pickGateSound([])).toBeNull();
  });
});
