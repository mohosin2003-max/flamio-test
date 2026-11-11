/**
 * Burger Boost procedural audio. Browser-safe: nothing touches Web Audio until
 * unlock() is called from a user gesture. No files, no network, no timers.
 * Audio is fire-and-forget and never affects gameplay.
 */
export type SoundEvent =
  | "start" | "gate" | "correct" | "wrong" | "collect" | "hazard"
  | "lane" | "gameOver" | "victory";

type Ctx = AudioContext;
export type AudioFactory = () => Ctx | null;

export const MAX_VOICES = 8;

const defaultFactory: AudioFactory = () => {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try { return new C(); } catch { return null; }
};

type Note = { f: number; f2?: number; at: number; dur: number; type?: OscillatorType; vol?: number };

const SOUNDS: Record<SoundEvent, Note[]> = {
  start: [{ f: 523, at: 0, dur: 0.09 }, { f: 659, at: 0.09, dur: 0.09 }, { f: 784, at: 0.18, dur: 0.16 }],
  gate: [{ f: 1800, at: 0, dur: 0.03, type: "square", vol: 0.08 }],
  correct: [{ f: 880, at: 0, dur: 0.08 }, { f: 1319, at: 0.08, dur: 0.16 }],
  wrong: [{ f: 440, f2: 300, at: 0, dur: 0.22, type: "triangle" }],
  collect: [{ f: 600, f2: 900, at: 0, dur: 0.12, type: "sine" }],
  hazard: [{ f: 110, at: 0, dur: 0.2, type: "sawtooth", vol: 0.12 }],
  lane: [{ f: 300, f2: 700, at: 0, dur: 0.08, type: "sine", vol: 0.08 }],
  gameOver: [{ f: 523, at: 0, dur: 0.15 }, { f: 392, at: 0.15, dur: 0.15 }, { f: 262, at: 0.3, dur: 0.35, type: "triangle" }],
  victory: [{ f: 523, at: 0, dur: 0.5 }, { f: 659, at: 0, dur: 0.5 }, { f: 784, at: 0, dur: 0.5 }, { f: 1047, at: 0.12, dur: 0.45 }],
};

export type AudioEngine = ReturnType<typeof createAudioEngine>;

export function createAudioEngine(factory: AudioFactory = defaultFactory) {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let muted = false;
  let held = false; // silenced by pause / hidden tab
  let disposed = false;
  let unsupported = false;
  const voices = new Set<OscillatorNode>();

  const stopAll = () => {
    for (const o of voices) { try { o.stop(); } catch { /* already stopped */ } try { o.disconnect(); } catch { /* noop */ } }
    voices.clear();
  };

  return {
    /** Call synchronously inside a user gesture. Never throws, never awaits. */
    unlock() {
      if (disposed || unsupported) return;
      try {
        if (!ctx) {
          ctx = factory();
          if (!ctx) { unsupported = true; return; }
          master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        }
        held = false;
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      } catch { unsupported = true; ctx = null; }
    },
    play(ev: SoundEvent) {
      if (disposed || muted || held || !ctx || !master || ctx.state !== "running") return;
      try {
        const t0 = ctx.currentTime;
        for (const n of SOUNDS[ev]) {
          if (voices.size >= MAX_VOICES) break;
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.type = n.type ?? "sine";
          o.frequency.setValueAtTime(n.f, t0 + n.at);
          if (n.f2) o.frequency.linearRampToValueAtTime(n.f2, t0 + n.at + n.dur);
          const v = n.vol ?? 0.15;
          g.gain.setValueAtTime(0.0001, t0 + n.at);
          g.gain.linearRampToValueAtTime(v, t0 + n.at + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
          o.connect(g); g.connect(master);
          o.onended = () => { voices.delete(o); try { o.disconnect(); g.disconnect(); } catch { /* noop */ } };
          voices.add(o);
          o.start(t0 + n.at); o.stop(t0 + n.at + n.dur + 0.02);
        }
      } catch { /* audio must never break gameplay */ }
    },
    setMuted(m: boolean) { muted = m; if (m) stopAll(); },
    isMuted: () => muted,
    /** Silence (pause / hidden tab). Resumed only via unlock() from a gesture. */
    hold() { held = true; stopAll(); try { if (ctx?.state === "running") void ctx.suspend().catch(() => {}); } catch { /* noop */ } },
    stopAll,
    activeVoices: () => voices.size,
    hasContext: () => ctx !== null,
    dispose() {
      if (disposed) return;
      disposed = true; stopAll();
      try { void ctx?.close().catch(() => {}); } catch { /* noop */ }
      ctx = null; master = null;
    },
  };
}

/** Pick one gate sound per frame so catch-up resolution never bursts. */
const PRIORITY: SoundEvent[] = ["hazard", "wrong", "correct", "collect", "gate"];
export function pickGateSound(events: readonly SoundEvent[]): SoundEvent | null {
  for (const p of PRIORITY) if (events.includes(p)) return p;
  return null;
}
