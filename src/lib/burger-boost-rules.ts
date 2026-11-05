/**
 * FLAMIO Burger Boost — pure rules + deterministic replay engine (STEP 04A).
 *
 * Database-free, network-free, side-effect-free. No Math.random(), no Date.
 * The seed is an INPUT only; it must come from the future server session
 * layer (never from the client). Nothing here is sent to the browser.
 *
 * PRNG: SplitMix64 on BigInt, all arithmetic masked to unsigned 64-bit.
 * Values are drawn with integer modulo (no floating point). The stream is
 * keyed by (seed XOR rulesVersion-mix), so the same seed + rulesVersion +
 * gateCount always yields the same track on every runtime.
 *
 * Client timestamps (`t`) are UNTRUSTED telemetry: they are only checked for
 * shape/ordering. Authoritative timing (started_at → expires_at → grace_until)
 * is enforced later by server code using server clocks.
 */

export const RULES_VERSION = 1;
export const GAMEPLAY_DURATION_MS = 60_000;
export const GRACE_PERIOD_MS = 15_000;
export const HARD_CUTOFF_MS = GAMEPLAY_DURATION_MS + GRACE_PERIOD_MS; // 75 s

export const MATH_OPERATIONS = ["+", "−", "×", "÷"] as const;
export const BURGER_INGREDIENTS = [
  "cheese", "lettuce", "sausage", "sauce", "mayo", "cucumber", "carrot", "tomato",
] as const;

export const MIN_GATE_COUNT = 1;
export const MAX_GATE_COUNT = 200;
export const LANES = 2;

/**
 * PROVISIONAL score weights. The final score formula is NOT approved yet;
 * these only make replay results comparable in tests. No discount derives
 * from them in this step.
 */
export const PROVISIONAL_SCORE = { mathCorrect: 10, ingredient: 5, spoiled: -5 } as const;

export type MathOp = (typeof MATH_OPERATIONS)[number];
export type Ingredient = (typeof BURGER_INGREDIENTS)[number];
export type Lane = 0 | 1;

export type MathGate = { kind: "math"; a: number; op: MathOp; b: number; lanes: [number, number]; correctLane: Lane };
export type IngredientGate = { kind: "ingredient"; lanes: [Ingredient, Ingredient] };
/** One lane is a spoiled ingredient, the other is safe (empty). */
export type NegativeGate = { kind: "negative"; spoiled: Ingredient; spoiledLane: Lane };
export type Gate = MathGate | IngredientGate | NegativeGate;

export type PlayerAction = { gateIndex: number; lane: number; t: number };
export type ReplayResult =
  | { valid: true; score: number; gatesPassed: number; mathCorrect: number; mathWrong: number; ingredients: Ingredient[]; spoiledHits: number; timingAuthoritative: false; error: null }
  | { valid: false; score: 0; gatesPassed: 0; timingAuthoritative: false; error: string };

// ---------- PRNG (SplitMix64) ----------
const MASK = (1n << 64n) - 1n;

export function createPrng(seed: bigint, rulesVersion: number) {
  let state = (BigInt.asUintN(64, seed) ^ BigInt.asUintN(64, BigInt(rulesVersion) * 0x9e3779b97f4a7c15n)) & MASK;
  const next = (): bigint => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  };
  /** Integer in [0, n). Rejection sampling removes modulo bias. */
  const int = (n: number): number => {
    const N = BigInt(n);
    const limit = (1n << 64n) - ((1n << 64n) % N);
    for (;;) { const v = next(); if (v < limit) return Number(v % N); }
  };
  return { next, int };
}

function toSeed(seed: bigint | number | string): bigint {
  if (typeof seed === "bigint") return seed;
  if (typeof seed === "number" && Number.isSafeInteger(seed)) return BigInt(seed);
  if (typeof seed === "string" && /^-?\d+$/.test(seed)) return BigInt(seed);
  throw new Error("invalid seed");
}

// ---------- Deterministic track ----------
function pick<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error("index out of range");
  return v;
}

function mathGate(r: ReturnType<typeof createPrng>): MathGate {
  const op = pick(MATH_OPERATIONS, r.int(4));
  let a: number, b: number, ans: number;
  switch (op) {
    case "+": a = 1 + r.int(20); b = 1 + r.int(20); ans = a + b; break;
    case "−": b = 1 + r.int(20); a = b + r.int(20); ans = a - b; break;
    case "×": a = 2 + r.int(9); b = 2 + r.int(9); ans = a * b; break;
    default: b = 2 + r.int(9); ans = 1 + r.int(10); a = ans * b; break; // exact division
  }
  const delta = 1 + r.int(5);
  const wrong = r.int(2) === 0 || ans - delta < 0 ? ans + delta : ans - delta;
  const correctLane = r.int(2) as Lane;
  const lanes: [number, number] = correctLane === 0 ? [ans, wrong] : [wrong, ans];
  return { kind: "math", a, op, b, lanes, correctLane };
}

export function generateTrack(seed: bigint | number | string, rulesVersion: number, gateCount: number): Gate[] {
  if (rulesVersion !== RULES_VERSION) throw new Error("unsupported rules version");
  if (!Number.isInteger(gateCount) || gateCount < MIN_GATE_COUNT || gateCount > MAX_GATE_COUNT) throw new Error("invalid gate count");
  const r = createPrng(toSeed(seed), rulesVersion);
  const track: Gate[] = [];
  for (let i = 0; i < gateCount; i++) {
    const k = r.int(10); // 5/10 math, 3/10 ingredient, 2/10 negative
    if (k < 5) track.push(mathGate(r));
    else if (k < 8) {
      const x = r.int(8); const y = (x + 1 + r.int(7)) % 8; // two distinct ingredients
      track.push({ kind: "ingredient", lanes: [pick(BURGER_INGREDIENTS, x), pick(BURGER_INGREDIENTS, y)] });
    } else track.push({ kind: "negative", spoiled: pick(BURGER_INGREDIENTS, r.int(8)), spoiledLane: r.int(2) as Lane });
  }
  return track;
}

// ---------- Replay ----------
const fail = (error: string): ReplayResult => ({ valid: false, score: 0, gatesPassed: 0, timingAuthoritative: false, error });

/**
 * Re-derives the track from the authoritative seed and replays the player's
 * lane choices. Any client-supplied score/discount fields are ignored. Actions
 * must cover gates 0..k-1 in order, exactly once each (a runner passes every
 * gate in sequence). `t` must be a non-decreasing integer in [0, 75000] — a
 * structural check only, never proof of real elapsed time.
 */
export function simulateBurgerBoostReplay(
  seed: bigint | number | string, gateCount: number, playerActions: unknown, rulesVersion: number = RULES_VERSION,
): ReplayResult {
  let track: Gate[];
  try { track = generateTrack(seed, rulesVersion, gateCount); } catch (e) { return fail((e as Error).message); }
  if (!Array.isArray(playerActions)) return fail("malformed actions");
  if (playerActions.length > gateCount) return fail("too many actions");

  let mathCorrect = 0, mathWrong = 0, spoiledHits = 0, lastT = -1;
  const ingredients: Ingredient[] = [];
  for (let i = 0; i < playerActions.length; i++) {
    const a = playerActions[i] as PlayerAction;
    if (!a || typeof a !== "object") return fail("malformed action");
    const keys = Object.keys(a).sort().join(",");
    if (keys !== "gateIndex,lane,t") return fail("malformed action");
    if (!Number.isInteger(a.gateIndex) || a.gateIndex < 0 || a.gateIndex >= gateCount) return fail("invalid gate index");
    if (a.gateIndex !== i) return fail("impossible gate progression");
    if (a.lane !== 0 && a.lane !== 1) return fail("invalid lane");
    if (!Number.isInteger(a.t) || a.t < 0 || a.t > HARD_CUTOFF_MS || a.t < lastT) return fail("malformed timing");
    lastT = a.t;
    const g = pick(track, i);
    if (g.kind === "math") { if (a.lane === g.correctLane) mathCorrect++; else mathWrong++; }
    else if (g.kind === "ingredient") ingredients.push(g.lanes[a.lane]);
    else if (a.lane === g.spoiledLane) spoiledHits++;
  }
  const raw = mathCorrect * PROVISIONAL_SCORE.mathCorrect + ingredients.length * PROVISIONAL_SCORE.ingredient + spoiledHits * PROVISIONAL_SCORE.spoiled;
  return { valid: true, score: Math.max(0, raw), gatesPassed: playerActions.length, mathCorrect, mathWrong, ingredients, spoiledHits, timingAuthoritative: false, error: null };
}
