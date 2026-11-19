/**
 * Burger Boost procedural audio. Browser-safe: nothing touches Web Audio until
 * unlock() is called from a user gesture. No files, no network, a single managed BGM interval (cleared on stop/hold/dispose).
 * Audio is fire-and-forget and never affects gameplay.
 *
 * Sound style: original cartoon-slapstick Foley built from harmonic-rich
 * oscillators, pitch bends, short attacks and wobble. All content sits in the
 * ~250 Hz – 2.6 kHz band that small phone speakers reproduce well.
 */
export type SoundEvent =
  | "start" | "gate" | "correct" | "wrong" | "collect" | "hazard"
  | "lane" | "gameOver" | "victory" | "milestone";

type Ctx = AudioContext;
export type AudioFactory = () => Ctx | null;

/** Hard cap on simultaneous oscillators. Every sound uses at most this many. */
export const MAX_VOICES = 4;
/** Master bus gain (before the soft compressor). */
export const MASTER_GAIN = 0.7;
/** Background-music bus gain (Step 62D: raised from 0.22 so BGM is audible on phone speakers). */
export const MUSIC_GAIN = 0.55;
/** Per-voice music levels. Bass is played one octave up (196–330 Hz) so phone speakers reproduce it. */
export const BGM_LEAD_VOL = 0.28;
export const BGM_BASS_VOL = 0.2;
export const BGM_BASS_OCTAVE = 2;
/** Sound-effects bus gain. */
export const SFX_GAIN = 1;
/** Background music tempo. */
export const BGM_BPM = 140;
/** One step = an eighth note at BGM_BPM (seconds). */
export const BGM_STEP_SEC = 60 / BGM_BPM / 2;
/** Max simultaneous music oscillators (separate from the SFX cap). */
export const MAX_MUSIC_VOICES = 3;
/** Scheduler look-ahead: steps are queued this far ahead of currentTime. */
export const BGM_LOOKAHEAD_SEC = 0.6;
export const BGM_TICK_MS = 100;
/** Gates (1-based) that trigger the milestone chime. */
export const MILESTONE_GATES = [15, 30] as const;
export function isMilestoneGate(passedGates: number): boolean {
  return (MILESTONE_GATES as readonly number[]).includes(passedGates);
}

/**
 * Original driving arcade-racer loop in A minor (Am – F – C – G), 32
 * eighth-note steps = 4 bars of 4/4. Pulsing octave bass on every step, a
 * syncopated square lead and an off-beat hi-hat tick. `lead`/`bass`/`hat` are
 * Hz or 0 (rest). Composed for this game; not derived from any existing song.
 */
const A4 = 440.0, B4 = 493.88, C5 = 523.25, D5 = 587.33, E5 = 659.25, F5 = 698.46, G5 = 783.99, A5 = 880.0;
const BA = 110.0, BF = 174.61, BC = 130.81, BG = 98.0;
const HAT = 2400;
const bar = (b: number, lead: number[]) => lead.map((l, i) => ({ lead: l, bass: i % 2 === 0 ? b : b * 2, hat: i % 2 === 1 ? HAT : 0 }));
export const BGM_PATTERN: ReadonlyArray<{ lead: number; bass: number; hat: number }> = [
  ...bar(BA, [A4, 0, C5, E5, 0, D5, C5, B4]),
  ...bar(BF, [A4, 0, C5, F5, 0, E5, C5, 0]),
  ...bar(BC, [G5, 0, E5, C5, 0, D5, E5, G5]),
  ...bar(BG, [A5, 0, G5, E5, D5, 0, B4, 0]),
];

export type TimerApi = { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
const defaultTimers: TimerApi = {
  set: (fn, ms) => setInterval(fn, ms),
  clear: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

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
  // Milestone chime (Gate 15 / Gate 30): bright rising pentatonic bell arpeggio.
  milestone: [
    n(0, 0.18, "sine", 0.30, [[0, 1046]], 0.002),
    n(0.09, 0.18, "sine", 0.30, [[0, 1319]], 0.002),
    n(0.18, 0.18, "sine", 0.30, [[0, 1568]], 0.002),
    n(0.27, 0.5, "triangle", 0.28, [[0, 2093], [0.45, 2093]], 0.002),
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

export function createAudioEngine(factory: AudioFactory = defaultFactory, timers: TimerApi = defaultTimers) {
  let ctx: Ctx | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let muted = false; // SFX mute
  let musicMuted = false;
  let musicWanted = false; // caller asked for music (survives hold/resume)
  let timer: unknown = null;
  let nextStepTime = 0;
  let step = 0;
  const musicVoices = new Set<OscillatorNode>();
  let held = false; // silenced by pause / hidden tab
  let disposed = false;
  let unsupported = false;
  const voices = new Set<OscillatorNode>();
  const stopAll = () => {
    for (const o of voices) { try { o.stop(); } catch { /* already stopped */ } try { o.disconnect(); } catch { /* noop */ } }
    voices.clear();
  };
  const stopMusicVoices = () => {
    for (const o of musicVoices) { try { o.stop(); } catch { /* noop */ } try { o.disconnect(); } catch { /* noop */ } }
    musicVoices.clear();
  };
  const stopScheduler = () => { if (timer !== null) { try { timers.clear(timer); } catch { /* noop */ } timer = null; } };
  const musicVoice = (hz: number, start: number, dur: number, type: OscillatorType, vol: number) => {
    if (!ctx || !musicBus || musicVoices.size >= MAX_MUSIC_VOICES) return;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(hz, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g); g.connect(musicBus);
    o.onended = () => { musicVoices.delete(o); try { o.disconnect(); g.disconnect(); } catch { /* noop */ } };
    musicVoices.add(o);
    o.start(start); o.stop(start + dur + 0.02);
  };
  const tick = () => {
    try {
      if (!ctx || ctx.state !== "running" || musicMuted || held || disposed) return;
      const horizon = ctx.currentTime + BGM_LOOKAHEAD_SEC;
      if (nextStepTime < ctx.currentTime) nextStepTime = ctx.currentTime + 0.05;
      while (nextStepTime < horizon) {
        const st = BGM_PATTERN[step % BGM_PATTERN.length]!;
        if (st.bass) musicVoice(st.bass * BGM_BASS_OCTAVE, nextStepTime, BGM_STEP_SEC * 0.95, "triangle", BGM_BASS_VOL);
        if (st.lead) musicVoice(st.lead, nextStepTime, BGM_STEP_SEC * 0.9, "square", BGM_LEAD_VOL);
        if (st.hat) musicVoice(st.hat, nextStepTime, 0.03, "triangle", BGM_LEAD_VOL * 0.35);
        nextStepTime += BGM_STEP_SEC; step++;
      }
    } catch { /* music must never break gameplay */ }
  };
  const ensureScheduler = () => {
    if (timer !== null || !musicWanted || musicMuted || held || disposed || !ctx) return;
    nextStepTime = 0; tick();
    timer = timers.set(tick, BGM_TICK_MS);
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
          sfxBus = ctx.createGain(); sfxBus.gain.value = SFX_GAIN; sfxBus.connect(master);
          musicBus = ctx.createGain(); musicBus.gain.value = MUSIC_GAIN; musicBus.connect(master);
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
        ensureScheduler();
      } catch { unsupported = true; ctx = null; }
    },
    play(ev: SoundEvent) {
      if (disposed || muted || held || !ctx || !sfxBus || ctx.state !== "running") return;
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
          o.connect(g); g.connect(sfxBus);
          o.onended = () => { voices.delete(o); try { o.disconnect(); g.disconnect(); } catch { /* noop */ } };
          voices.add(o);
          o.start(start); o.stop(end + 0.02);
        }
      } catch { /* audio must never break gameplay */ }
    },
    /** Legacy single toggle: mutes/unmutes SFX only (music has its own control). */
    setMuted(m: boolean) { muted = m; if (m) stopAll(); },
    isMuted: () => muted,
    setSfxMuted(m: boolean) { muted = m; if (m) stopAll(); },
    isSfxMuted: () => muted,
    setMusicMuted(m: boolean) {
      musicMuted = m;
      if (m) { stopScheduler(); stopMusicVoices(); } else ensureScheduler();
    },
    isMusicMuted: () => musicMuted,
    /** Begin the continuous BGM loop (idempotent — never creates a second loop). */
    startMusic() { if (disposed) return; musicWanted = true; step = 0; ensureScheduler(); },
    stopMusic() { musicWanted = false; stopScheduler(); stopMusicVoices(); },
    isMusicPlaying: () => timer !== null,
    isHeld: () => held,
    activeMusicVoices: () => musicVoices.size,
    /** Silence (pause / hidden tab). Resumed only via unlock() from a gesture. */
    hold() { held = true; stopAll(); stopScheduler(); stopMusicVoices(); try { if (ctx?.state === "running") void ctx.suspend().catch(() => {}); } catch { /* noop */ } },
    stopAll,
    activeVoices: () => voices.size,
    hasContext: () => ctx !== null,
    hasCompressor: () => comp !== null,
    dispose() {
      if (disposed) return;
      disposed = true; musicWanted = false; stopScheduler(); stopMusicVoices(); stopAll();
      try { comp?.disconnect(); sfxBus?.disconnect(); musicBus?.disconnect(); master?.disconnect(); } catch { /* noop */ }
      try { void ctx?.close().catch(() => {}); } catch { /* noop */ }
      ctx = null; master = null; comp = null; sfxBus = null; musicBus = null;
    },
  };
}

/** Pick one gate sound per frame so catch-up resolution never bursts. */
const PRIORITY: SoundEvent[] = ["milestone", "hazard", "wrong", "correct", "collect", "gate"];
export function pickGateSound(events: readonly SoundEvent[]): SoundEvent | null {
  for (const p of PRIORITY) if (events.includes(p)) return p;
  return null;
}
