/**
 * Pure, deterministic victory/loss pose timeline for the Burger Boost result
 * scene. Visual only: never reads or changes score, meter or reward state.
 * Pose = f(elapsed ms, loss), so any frame rate renders identical frames.
 */
export const VICTORY_MS = 2600;

export type VictoryPhase = "hold" | "raise" | "bite" | "chew" | "celebrate" | "final";

export type VictoryPose = {
  phase: VictoryPhase;
  appear: number;    // 0..1 fade/scale-in
  lift: number;      // 0..1 burger raised toward mouth
  mouthOpen: number; // 0..1
  bites: number;     // 0 or 1 bite cut-out shown
  chew: number;      // -1..1 jaw/head bob
  cheer: number;     // 0..1 celebration (arms up a little, sparkle)
  headDrop: number;  // 0..1 sad head/shoulder lowering (loss only)
  sad: boolean;
  done: boolean;
};

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const span = (t: number, a: number, b: number) => ease((t - a) / (b - a));

/** Existing result classification: Boost Power at or below 0 is a poor result. */
export function isLossResult(meter: number): boolean { return meter <= 0; }

export function victoryPose(elapsedMs: number, loss = false): VictoryPose {
  const t = Math.max(0, Math.min(VICTORY_MS, Number.isFinite(elapsedMs) ? elapsedMs : 0));
  const appear = span(t, 0, 400);
  const done = t >= VICTORY_MS;
  if (loss) {
    return { phase: done ? "final" : "hold", appear, lift: 0, mouthOpen: 0, bites: 0, chew: 0, cheer: 0,
      headDrop: span(t, 300, 1400), sad: true, done };
  }
  const phase: VictoryPhase = t < 400 ? "hold" : t < 900 ? "raise" : t < 1450 ? "bite" : t < 1900 ? "chew" : t < 2300 ? "celebrate" : "final";
  // Lift: raise 400-900, push to mouth during bite, settle during chew, lower 1900-2300.
  const lift = span(t, 400, 900) * 0.6 + span(t, 900, 1150) * 0.4 - span(t, 1150, 1450) * 0.4 - span(t, 1900, 2300) * 0.45;
  const mouthOpen = t >= 900 && t < 1450 ? Math.sin(clamp01((t - 900) / 550) * Math.PI) : 0;
  const bites = t >= 1150 ? 1 : 0;
  const chew = t >= 1450 && t < 1900 ? Math.sin(((t - 1450) / 450) * Math.PI * 4) * (1 - (t - 1450) / 450 * 0.5) : 0;
  const cheer = span(t, 1900, 2300);
  return { phase, appear, lift: clamp01(lift), mouthOpen, bites, chew, cheer, headDrop: 0, sad: false, done };
}
