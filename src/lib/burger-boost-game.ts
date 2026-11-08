/**
 * FLAMIO Burger Boost — browser-safe PRACTICE game state (Phase 1–2 UI).
 *
 * Pure, deterministic, no I/O. Reuses the shared rules engine for track
 * generation and scoring so the practice game matches the server replay
 * contract (actions = [{ gateIndex, lane, t }]).
 *
 * IMPORTANT: The server SessionDTO deliberately exposes NO gate data and the
 * server seed is never sent to the browser. Until a public-gate contract
 * exists, the browser runs PRACTICE ONLY with a locally generated seed.
 * Practice scores are provisional, never submitted, and award 0% discount.
 */
import {
  generateTrack, simulateBurgerBoostReplay, PROVISIONAL_SCORE, RULES_VERSION,
  GAMEPLAY_DURATION_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS, MIN_GATE_COUNT, MAX_GATE_COUNT,
  type Gate, type Ingredient, type Lane, type PlayerAction,
} from "./burger-boost-rules";

export const DEFAULT_GATE_COUNT = 30;
export const STACK_TARGET_MIN = 34;
export const STACK_TARGET_MAX = 66;
export const AWARDED_DISCOUNT_PERCENT = 0 as const;
export { GAMEPLAY_DURATION_MS, GRACE_PERIOD_MS, HARD_CUTOFF_MS };

export type Phase = "idle" | "running" | "grace" | "finished" | "expired";

export type GameState = {
  track: Gate[];
  gateCount: number;
  lane: Lane;
  nextGate: number;
  actions: PlayerAction[];
  layers: Array<Ingredient>;
  score: number;
  mathCorrect: number;
  mathWrong: number;
  spoiledHits: number;
  phase: Phase;
};

export function normalizeGateCount(n: unknown): number {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_GATE_COUNT && n <= MAX_GATE_COUNT ? n : DEFAULT_GATE_COUNT;
}

export function createGame(seed: bigint | string | number, gateCount: number = DEFAULT_GATE_COUNT): GameState {
  const n = normalizeGateCount(gateCount);
  return {
    track: generateTrack(seed, RULES_VERSION, n), gateCount: n, lane: 0, nextGate: 0, actions: [],
    layers: [], score: 0, mathCorrect: 0, mathWrong: 0, spoiledHits: 0, phase: "running",
  };
}

/** Phase from elapsed ms of the (local practice) clock. Never extends past 75 s. */
export function phaseAt(elapsedMs: number): "running" | "grace" | "expired" {
  if (elapsedMs < GAMEPLAY_DURATION_MS) return "running";
  if (elapsedMs < HARD_CUTOFF_MS) return "grace";
  return "expired";
}

export function switchLane(s: GameState, lane: Lane): GameState {
  if (s.phase !== "running" && s.phase !== "grace") return s;
  return s.lane === lane ? s : { ...s, lane };
}

/** Max collectible layers = number of ingredient gates on the track. */
export function stackCapacity(track: Gate[]): number {
  return Math.max(1, track.filter((g) => g.kind === "ingredient").length);
}

export function stackPercent(s: Pick<GameState, "layers" | "track">): number {
  return Math.min(100, Math.round((s.layers.length / stackCapacity(s.track)) * 100));
}

export function inTargetRange(pct: number): boolean {
  return pct >= STACK_TARGET_MIN && pct <= STACK_TARGET_MAX;
}

/** Math gate label for a lane, e.g. "12". Division is always exact by construction. */
export function mathAnswer(a: number, op: string, b: number): number | null {
  switch (op) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 || a % b !== 0 ? null : a / b;
    default: return null;
  }
}

export type GateOutcome = "correct" | "wrong" | "collect" | "spoiled" | "safe";

/** Resolve the next gate in the player's current lane at practice time t (ms). */
export function passGate(s: GameState, t: number): { state: GameState; outcome: GateOutcome | null } {
  if ((s.phase !== "running" && s.phase !== "grace") || s.nextGate >= s.gateCount) return { state: s, outcome: null };
  const tt = Math.max(s.actions.at(-1)?.t ?? 0, Math.min(HARD_CUTOFF_MS, Math.max(0, Math.floor(t))));
  if (phaseAt(tt) === "expired") return { state: { ...s, phase: "expired" }, outcome: null };
  const g = s.track[s.nextGate]!;
  const lane = s.lane;
  let { score, mathCorrect, mathWrong, spoiledHits } = s;
  let layers = s.layers;
  let outcome: GateOutcome;
  if (g.kind === "math") {
    if (lane === g.correctLane) { mathCorrect++; score += PROVISIONAL_SCORE.mathCorrect; outcome = "correct"; }
    else { mathWrong++; outcome = "wrong"; }
  } else if (g.kind === "ingredient") {
    layers = [...layers, g.lanes[lane]]; score += PROVISIONAL_SCORE.ingredient; outcome = "collect";
  } else if (lane === g.spoiledLane) {
    spoiledHits++; score += PROVISIONAL_SCORE.spoiled; layers = layers.slice(0, -1); outcome = "spoiled";
  } else outcome = "safe";
  const nextGate = s.nextGate + 1;
  const actions = [...s.actions, { gateIndex: s.nextGate, lane, t: tt }];
  const phase: Phase = nextGate >= s.gateCount ? "finished" : phaseAt(tt);
  return { state: { ...s, score: Math.max(0, score), mathCorrect, mathWrong, spoiledHits, layers, nextGate, actions, phase }, outcome };
}

/** Cross-check: practice score equals the shared server replay result. */
export function replayScore(seed: bigint | string | number, s: GameState): number | null {
  const r = simulateBurgerBoostReplay(seed, s.gateCount, s.actions);
  return r.valid ? r.score : null;
}

/** Practice seed: browser-local, never the server seed. Call from handlers only. */
export function practiceSeed(): bigint {
  const b = new BigUint64Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] as bigint;
}
