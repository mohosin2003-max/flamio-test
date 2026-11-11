/**
 * Burger Boost procedural audio. Browser-safe: nothing touches Web Audio until
 * unlock() is called from a user gesture. No files, no network, no timers.
 * Audio is fire-and-forget and never affects gameplay.
 *
 * Sound style: original cartoon-slapstick Foley built from harmonic-rich
 * oscillators, pitch bends, short attacks and wobble. All content sits in the
 * ~250 Hz – 2.6 kHz band that small phone speakers reproduce well.
 */
export type SoundEvent =
  | "start" | "gate" | "correct" | "wrong" | "collect" | "hazard"
  | "lane" | "gameOver" | "victory";

type Ctx = AudioContext;
export type AudioFactory = () => Ctx | null;

/** Hard cap on simultaneous oscillators. Every sound uses at most this many. */
export const MAX_VOICES = 4;
/** Master bus gain (before the soft compressor). */
export const MASTER_GAIN = 0.7;

const defaultFactory: AudioFactory = () => {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try { return new C(); } catch { return null; }
};

/**
 * One oscillator voice. `pitch` is a list of [timeOffsetSec, Hz] points
 * (relative to `at`) ramped exponentially, which gives bends, slides and wobble
 * without an extra LFO voice.
 */
export type Note = {
  at: number; dur: number; type: OscillatorType; vol: number;
  pitch: ReadonlyArray<readonly [number, number]>;
  attack?: number;
};

const n = (at: number, dur: number, type: OscillatorType, vol: number, pitch: Note["pitch"], attack = 0.004): Note =>
  ({ at, dur, type, vol, pitch, attack });

/** Wobble helper: alternating pitch points between from→to with ±depth. */
function wobble(from: number, to: number, dur: number, cycles: number, depth: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const steps = cycles * 2;
  for (let i = 0; i <= steps; i++) {
    const t = (dur * i) / steps;
    const base = from * Math.pow(to / from, i / steps);
    pts.push([t, base * (i % 2 ? 1 + depth : 1 - depth * 0.5)]);
  }
  return pts;
}

export const SOUNDS: Record<SoundEvent, Note[]> = {
  // Race-launch whistle: rising zip, then a bright two-note flourish.
  start: [
    n(0, 0.16, "triangle", 0.30, [[0, 420], [0.14, 1250]]),
    n(0, 0.16, "square", 0.06, [[0, 840], [0.14, 2400]]),
    n(0.15, 0.10, "triangle", 0.30, [[0, 784]]),
    n(0.24, 0.22, "triangle", 0.32, [[0, 1046], [0.05, 1175], [0.2, 1046]]),
  ],
  // Hollow woodblock tap: fast descending knock.
  gate: [
    n(0, 0.06, "triangle", 0.34, [[0, 1100], [0.05, 520]], 0.002),
    n(0, 0.03, "square", 0.05, [[0, 2200], [0.025, 900]], 0.002),
  ],
  // Marimba / bell double-pop.
  correct: [
    n(0, 0.10, "triangle", 0.32, [[0, 784]], 0.002),
    n(0, 0.08, "sine", 0.14, [[0, 1568]], 0.002),
    n(0.08, 0.22, "triangle", 0.34, [[0, 1175], [0.02, 1319]], 0.002),
    n(0.08, 0.18, "sine", 0.14, [[0, 2637]], 0.002),
  ],
  // Slide-whistle droop with comic wobble.
  wrong: [
    n(0, 0.34, "triangle", 0.32, wobble(640, 230, 0.32, 4, 0.06), 0.006),
    n(0, 0.34, "sawtooth", 0.05, wobble(640, 230, 0.32, 4, 0.06), 0.006),
  ],
  // Cork pop then a rising bubble.
  collect: [
    n(0, 0.03, "square", 0.12, [[0, 1500], [0.025, 400]], 0.001),
    n(0, 0.03, "triangle", 0.30, [[0, 1100], [0.025, 360]], 0.001),
    n(0.035, 0.13, "triangle", 0.30, [[0, 420], [0.12, 980]], 0.004),
    n(0.035, 0.13, "sine", 0.12, [[0, 840], [0.12, 1960]], 0.004),
  ],
  // Metallic clang (dissonant pair) + rubbery recoil.
  hazard: [
    n(0, 0.18, "square", 0.10, [[0, 620], [0.17, 590]], 0.001),
    n(0, 0.18, "triangle", 0.30, [[0, 880], [0.17, 830]], 0.001),
    n(0, 0.22, "sawtooth", 0.07, [[0, 1310], [0.2, 1240]], 0.001),
    n(0.06, 0.26, "triangle", 0.30, wobble(360, 220, 0.24, 3, 0.12), 0.004),
  ],
  // Quick swoop.
  lane: [
    n(0, 0.09, "triangle", 0.22, [[0, 380], [0.045, 860], [0.085, 540]], 0.004),
  ],
  // Comic trombone "wah-wah-wah-waaah".
  gameOver: [
    n(0, 0.17, "sawtooth", 0.12, [[0, 466], [0.15, 452]], 0.012),
    n(0.18, 0.17, "sawtooth", 0.12, [[0, 440], [0.15, 426]], 0.012),
    n(0.36, 0.17, "sawtooth", 0.12, [[0, 415], [0.15, 402]], 0.012),
    n(0.54, 0.6, "sawtooth", 0.13, wobble(392, 300, 0.58, 6, 0.035), 0.012),
  ],
  // Bugle flourish resolving to a ringing chord (4 voices total).
  victory: [
    n(0, 0.12, "triangle", 0.30, [[0, 523]], 0.003),
    n(0.11, 0.12, "triangle", 0.30, [[0, 659]], 0.003),
    n(0.22, 0.12, "triangle", 0.30, [[0, 784]], 0.003),
    n(0.33, 0.6, "square", 0.10, [[0, 1046], [0.06, 1108], [0.12, 1046], [0.58, 1046]], 0.003),
  ],
};

export type AudioEngine = ReturnType<typeof createAudioEngine>;

export function createAudioEngine(factory: AudioFactory = defaultFactory) {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
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
          master = ctx.createGain(); master.gain.value = MASTER_GAIN;
          // Conservative soft compression to tame layered peaks. Not a true peak limiter.
          try {
            comp = ctx.createDynamicsCompressor();
            comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6;
            comp.attack.value = 0.003; comp.release.value = 0.12;
            master.connect(comp); comp.connect(ctx.destination);
          } catch { comp = null; master.connect(ctx.destination); }
        }
        held = false;
        if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      } catch { unsupported = true; ctx = null; }
    },
    play(ev: SoundEvent) {
      if (disposed || muted || held || !ctx || !master || ctx.state !== "running") return;
      try {
        const t0 = ctx.currentTime;
        for (const note of SOUNDS[ev]) {
          if (voices.size >= MAX_VOICES) break;
          const o = ctx.createOscillator(); const g = ctx.createGain();
          const start = t0 + note.at; const end = start + note.dur;
          o.type = note.type;
          const [first, ...rest] = note.pitch;
          o.frequency.setValueAtTime(first![1], start + first![0]);
          for (const [dt, hz] of rest) o.frequency.exponentialRampToValueAtTime(hz, start + dt);
          g.gain.setValueAtTime(0.0001, start);
          g.gain.linearRampToValueAtTime(note.vol, start + (note.attack ?? 0.004));
          g.gain.exponentialRampToValueAtTime(0.0001, end);
          o.connect(g); g.connect(master);
          o.onended = () => { voices.delete(o); try { o.disconnect(); g.disconnect(); } catch { /* noop */ } };
          voices.add(o);
          o.start(start); o.stop(end + 0.02);
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
    hasCompressor: () => comp !== null,
    dispose() {
      if (disposed) return;
      disposed = true; stopAll();
      try { comp?.disconnect(); master?.disconnect(); } catch { /* noop */ }
      try { void ctx?.close().catch(() => {}); } catch { /* noop */ }
      ctx = null; master = null; comp = null;
    },
  };
}

/** Pick one gate sound per frame so catch-up resolution never bursts. */
const PRIORITY: SoundEvent[] = ["hazard", "wrong", "correct", "collect", "gate"];
export function pickGateSound(events: readonly SoundEvent[]): SoundEvent | null {
  for (const p of PRIORITY) if (events.includes(p)) return p;
  return null;
}
