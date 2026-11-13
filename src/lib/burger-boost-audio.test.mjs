import { describe, expect, test } from "bun:test";
import { createAudioEngine, pickGateSound, MAX_VOICES, MASTER_GAIN, SOUNDS } from "./burger-boost-audio";

const EVENTS = ["start", "gate", "correct", "wrong", "collect", "hazard", "lane", "gameOver", "victory"];

function param(log, name) {
  const rec = (kind) => (v, t) => {
    if (!Number.isFinite(v) || !Number.isFinite(t) || t < 0) log.bad.push(`${name}.${kind}(${v},${t})`);
    if (kind === "exp" && v <= 0) log.bad.push(`${name}.exp<=0`);
    log.calls.push([name, kind, v, t]);
  };
  return { value: 0, setValueAtTime: rec("set"), linearRampToValueAtTime: rec("lin"), exponentialRampToValueAtTime: rec("exp") };
}
function fakeCtx({ compressor = true } = {}) {
  let created = 0;
  const log = { bad: [], calls: [], edges: [] };
  const node = (id) => ({ id, connect(to) { log.edges.push([id, to.id ?? to]); }, disconnect() {} });
  const ctx = {
    state: "running", currentTime: 0, destination: { id: "dest" }, closed: false,
    resume: async () => { ctx.state = "running"; }, suspend: async () => { ctx.state = "suspended"; },
    close: async () => { ctx.closed = true; },
    createGain: () => ({ ...node("gain"), gain: param(log, "gain") }),
    createOscillator: () => { created++; return { ...node("osc"), type: "", frequency: param(log, "freq"), start() {}, stop() {}, onended: null }; },
  };
  if (compressor) ctx.createDynamicsCompressor = () => ({ ...node("comp"), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
  return { ctx, log, count: () => created };
}

describe("burger boost audio", () => {
  test("no context until unlock, one context reused", () => {
    let n = 0; const f = fakeCtx();
    const e = createAudioEngine(() => { n++; return f.ctx; });
    e.play("start"); expect(n).toBe(0); expect(f.count()).toBe(0);
    e.unlock(); e.unlock(); expect(n).toBe(1);
    e.play("start"); expect(f.count()).toBe(SOUNDS.start.length);
  });
  test("master gain feeds compressor feeds destination", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    expect(e.hasCompressor()).toBe(true);
    expect(f.log.edges).toContainEqual(["gain", "comp"]);
    expect(f.log.edges).toContainEqual(["comp", "dest"]);
    expect(MASTER_GAIN).toBe(0.7);
  });
  test("no compressor support falls back to direct output", () => {
    const f = fakeCtx({ compressor: false }); const e = createAudioEngine(() => f.ctx); e.unlock();
    expect(e.hasCompressor()).toBe(false);
    expect(f.log.edges).toContainEqual(["gain", "dest"]);
  });
  test("all nine events schedule finite, valid ramps", () => {
    for (const ev of EVENTS) {
      const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
      e.play(ev);
      expect(f.log.bad).toEqual([]);
      expect(f.count()).toBeGreaterThan(0);
      for (const note of SOUNDS[ev]) {
        expect(note.dur).toBeGreaterThan(0);
        for (const [dt, hz] of note.pitch) { expect(dt).toBeLessThanOrEqual(note.dur); expect(hz).toBeGreaterThan(0); }
      }
    }
  });
  test("every sound fits within the voice cap and differs from the others", () => {
    expect(MAX_VOICES).toBe(4);
    const sigs = new Set(EVENTS.map((ev) => JSON.stringify(SOUNDS[ev])));
    expect(sigs.size).toBe(9);
    for (const ev of EVENTS) expect(SOUNDS[ev].length).toBeLessThanOrEqual(MAX_VOICES);
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
  test("voices never exceed four", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    for (let i = 0; i < 20; i++) for (const ev of EVENTS) e.play(ev);
    expect(e.activeVoices()).toBe(4);
  });
  test("hold silences until unlocked again", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    e.play("hazard"); e.hold(); expect(e.activeVoices()).toBe(0);
    e.play("gate"); expect(e.activeVoices()).toBe(0);
    e.unlock(); e.play("lane"); expect(e.activeVoices()).toBe(1);
  });
  test("dispose closes context and later plays are no-ops", () => {
    const f = fakeCtx(); const e = createAudioEngine(() => f.ctx); e.unlock();
    e.play("victory"); e.dispose(); expect(f.ctx.closed).toBe(true); expect(e.activeVoices()).toBe(0);
    e.unlock(); e.play("victory"); expect(e.hasContext()).toBe(false);
  });
  test("multiple gates in one frame produce one sound", () => {
    expect(pickGateSound(["collect", "gate", "hazard"])).toBe("hazard");
    expect(pickGateSound(["gate", "correct"])).toBe("correct");
    expect(pickGateSound([])).toBeNull();
  });
  test("public API unchanged", () => {
    const e = createAudioEngine(() => null);
    for (const k of ["unlock", "play", "setMuted", "isMuted", "hold", "stopAll", "dispose", "activeVoices", "hasContext"]) expect(typeof e[k]).toBe("function");
  });
});

import { MUSIC_GAIN, BGM_LEAD_VOL, BGM_BASS_VOL, BGM_BASS_OCTAVE, BGM_PATTERN } from "./burger-boost-audio";
describe("step 62D bgm", () => {
  const timers = () => { const live = new Set(); let id = 0; return { live, api: { set: () => { const h = ++id; live.add(h); return h; }, clear: (h) => live.delete(h) } }; };
  test("effective lead gain well above old 0.0185", () => {
    expect(MUSIC_GAIN * BGM_LEAD_VOL * MASTER_GAIN).toBeGreaterThan(0.05);
    expect(MUSIC_GAIN).toBeLessThanOrEqual(0.7);
  });
  test("bass sits in phone-speaker range", () => {
    for (const st of BGM_PATTERN) if (st.bass) expect(st.bass * BGM_BASS_OCTAVE).toBeGreaterThanOrEqual(190);
    expect(BGM_BASS_VOL).toBeLessThan(0.5);
  });
  test("repeated hold/unlock never duplicates the scheduler", () => {
    const f = fakeCtx(); const t = timers(); const e = createAudioEngine(() => f.ctx, t.api);
    e.unlock(); e.startMusic();
    for (let i = 0; i < 5; i++) { e.hold(); f.ctx.state = "running"; e.unlock(); e.unlock(); }
    expect(t.live.size).toBe(1); expect(e.activeMusicVoices()).toBeLessThanOrEqual(3);
    e.startMusic(); expect(t.live.size).toBe(1);
  });
  test("dispose releases scheduler and context", () => {
    const f = fakeCtx(); const t = timers(); const e = createAudioEngine(() => f.ctx, t.api);
    e.unlock(); e.startMusic(); e.dispose();
    expect(t.live.size).toBe(0); expect(f.ctx.closed).toBe(true); expect(e.activeMusicVoices()).toBe(0);
  });
});
