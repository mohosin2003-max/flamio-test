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
/** Rules v2: strategic Operation Gates + single Discount Meter (Step 48/49). */
export const OPERATION_RULES_VERSION = 2;
/**
 * Rules v3 (Step 63): v2 meter semantics + onion/capsicum, tiered difficulty
 * and an accelerating gate schedule. LOCAL PRACTICE ONLY — saved sessions stay
 * on v2 (database constraint), so v1/v2 tracks and replays are unchanged.
 */
export const TIERED_RULES_VERSION = 3;
export const SUPPORTED_RULES_VERSIONS = [RULES_VERSION, OPERATION_RULES_VERSION, TIERED_RULES_VERSION] as const;
/** v2 and v3 both use the single Discount Meter. */
export function isMeterRules(v: number): boolean { return v === OPERATION_RULES_VERSION || v === TIERED_RULES_VERSION; }
export const GAMEPLAY_DURATION_MS = 60_000;
export const GRACE_PERIOD_MS = 15_000;
export const HARD_CUTOFF_MS = GAMEPLAY_DURATION_MS + GRACE_PERIOD_MS; // 75 s

export const MATH_OPERATIONS = ["+", "−", "×", "÷"] as const;
export const BURGER_INGREDIENTS = [
  "cheese", "lettuce", "sausage", "sauce", "mayo", "cucumber", "carrot", "tomato",
] as const;
/** v3 pool: the frozen v1/v2 eight + onion, capsicum (appended, so v1/v2 indices never move). */
export const V3_INGREDIENTS = [...BURGER_INGREDIENTS, "onion", "capsicum"] as const;

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
export type Ingredient = (typeof V3_INGREDIENTS)[number];
export type Lane = 0 | 1;

export type MathGate = { kind: "math"; a: number; op: MathOp; b: number; lanes: [number, number]; correctLane: Lane };
export type IngredientGate = { kind: "ingredient"; lanes: [Ingredient, Ingredient] };
/** One lane is a spoiled ingredient, the other is safe (empty). */
export type NegativeGate = { kind: "negative"; spoiled: Ingredient; spoiledLane: Lane };
/** v2: each lane is a deterministic integer transformation of the meter. */
export type OpChoice = { op: MathOp; v: number };
export type OperationGate = { kind: "op"; lanes: [OpChoice, OpChoice] };
export type Gate = MathGate | IngredientGate | NegativeGate | OperationGate;

/** v2 meter constants (whole percent, integers only). */
export const METER = { start: 0, min: -100, max: 200, ingredient: 1, hazard: -12, maxMultipliers: 2 } as const;

/**
 * Apply one operation to the meter. Integer-only, no floats:
 *  + / − add/subtract v; × multiplies by v; ÷ divides by v truncating toward
 *  zero (v ≥ 2 by construction, so division by zero is impossible). The
 *  result is clamped to [METER.min, METER.max].
 */
export function applyOp(meter: number, c: OpChoice): number {
  if (!Number.isInteger(meter) || !Number.isInteger(c.v) || c.v < 1) throw new Error("invalid operation");
  let m: number;
  switch (c.op) {
    case "+": m = meter + c.v; break;
    case "−": m = meter - c.v; break;
    case "×": m = meter * c.v; break;
    case "÷": if (c.v < 2) throw new Error("invalid divisor"); m = Math.trunc(meter / c.v); break;
    default: throw new Error("invalid operation");
  }
  return Math.max(METER.min, Math.min(METER.max, m));
}
export const clampMeter = (m: number) => Math.max(METER.min, Math.min(METER.max, Math.trunc(m)));
export const formatOp = (c: OpChoice) => `${c.op}${c.v}${c.op === "+" || c.op === "−" ? "%" : ""}`;

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

/**
 * v2 strategic pair. Pairs are risk/reward trade-offs, never a quiz:
 *  20%: +a vs ×2  (×2 only while the 2-per-track budget lasts, else +b)
 *  30%: −a vs ÷2  (damage control: which hurts less depends on the meter sign/size)
 *  30%: +a vs −b  (avoid the trap)
 *  20%: +a vs +b  (pick the bigger boost)
 */
function opGate(r: ReturnType<typeof createPrng>, mulLeft: { n: number }): OperationGate {
  const k = r.int(10);
  const add = () => ({ op: "+" as const, v: 3 * (1 + r.int(4)) }); // +3..+12
  const sub = () => ({ op: "−" as const, v: 5 * (1 + r.int(4)) }); // −5..−20
  let pair: [OpChoice, OpChoice];
  if (k < 2) {
    const a = add();
    if (mulLeft.n > 0) { mulLeft.n--; pair = [a, { op: "×", v: 2 }]; }
    else pair = [a, add()];
  } else if (k < 5) pair = [sub(), { op: "÷", v: 2 }];
  else if (k < 8) pair = [add(), sub()];
  else pair = [add(), add()];
  if (r.int(2) === 1) pair = [pair[1], pair[0]];
  return { kind: "op", lanes: pair };
}

export function generateTrack(seed: bigint | number | string, rulesVersion: number, gateCount: number): Gate[] {
  if (rulesVersion === OPERATION_RULES_VERSION) return generateOperationTrack(seed, gateCount);
  if (rulesVersion === TIERED_RULES_VERSION) return generateTieredTrack(seed, gateCount);
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

function generateOperationTrack(seed: bigint | number | string, gateCount: number): Gate[] {
  if (!Number.isInteger(gateCount) || gateCount < MIN_GATE_COUNT || gateCount > MAX_GATE_COUNT) throw new Error("invalid gate count");
  const r = createPrng(toSeed(seed), OPERATION_RULES_VERSION);
  const mulLeft = { n: METER.maxMultipliers };
  const track: Gate[] = [];
  for (let i = 0; i < gateCount; i++) {
    const k = i === 0 ? 0 : r.int(10); // first gate is always an operation so the meter can start moving
    if (k < 5) track.push(opGate(r, mulLeft));
    else if (k < 8) {
      const x = r.int(8); const y = (x + 1 + r.int(7)) % 8;
      track.push({ kind: "ingredient", lanes: [pick(BURGER_INGREDIENTS, x), pick(BURGER_INGREDIENTS, y)] });
    } else track.push({ kind: "negative", spoiled: pick(BURGER_INGREDIENTS, r.int(8)), spoiledLane: r.int(2) as Lane });
  }
  return track;
}

/** Difficulty tier of gate i (0 early, 1 intermediate, 2 advanced): thirds of the track. */
export function difficultyTier(i: number, gateCount: number): 0 | 1 | 2 {
  return Math.min(2, Math.floor((3 * i) / gateCount)) as 0 | 1 | 2;
}

/**
 * v3 tiered pair.
 *  Early:    clear choices — +a vs +b (gap ≥3), or +a vs small −b.
 *  Middle:   the v2 mix (×2 budget, −a vs ÷2, +a vs −b, +a vs +b).
 *  Advanced: harder trade-offs — ×2 vs big +a, −a vs ÷2, −a vs −b (least harm), big +a vs −b.
 */
function tieredOpGate(r: ReturnType<typeof createPrng>, mulLeft: { n: number }, tier: 0 | 1 | 2): OperationGate {
  const k = r.int(10);
  let pair: [OpChoice, OpChoice];
  if (tier === 0) {
    const add = () => ({ op: "+" as const, v: 3 * (1 + r.int(4)) }); // +3..+12
    if (k < 5) { const a = add(); pair = [a, { op: "+", v: a.v + 3 * (1 + r.int(2)) }]; } // +a vs +(a+3|a+6)
    else pair = [add(), { op: "−", v: 5 * (1 + r.int(2)) }]; // −5 / −10
  } else if (tier === 1) {
    pair = opGate(r, mulLeft).lanes;
  } else {
    const bigAdd = () => ({ op: "+" as const, v: 6 * (1 + r.int(3)) }); // +6..+18
    const sub = () => ({ op: "−" as const, v: 5 * (2 + r.int(4)) }); // −10..−25
    if (k < 3) {
      const a = bigAdd();
      if (mulLeft.n > 0) { mulLeft.n--; pair = [a, { op: "×", v: 2 }]; } else pair = [a, bigAdd()];
    } else if (k < 6) pair = [sub(), { op: "÷", v: 2 }];
    else if (k < 8) { const a = sub(); let b = sub(); if (b.v === a.v) b = { op: "−", v: a.v === 25 ? 10 : a.v + 5 }; pair = [a, b]; }
    else pair = [bigAdd(), sub()];
  }
  // v3 never offers two identical lanes (meaningless choice)
  if (pair[0].op === pair[1].op && pair[0].v === pair[1].v) pair = [pair[0], { op: pair[1].op, v: pair[1].v + (pair[1].op === "+" ? 3 : 5) }];
  if (tier === 1) return { kind: "op", lanes: pair };
  if (r.int(2) === 1) pair = [pair[1], pair[0]];
  return { kind: "op", lanes: pair };
}

function generateTieredTrack(seed: bigint | number | string, gateCount: number): Gate[] {
  if (!Number.isInteger(gateCount) || gateCount < MIN_GATE_COUNT || gateCount > MAX_GATE_COUNT) throw new Error("invalid gate count");
  const r = createPrng(toSeed(seed), TIERED_RULES_VERSION);
  const mulLeft = { n: METER.maxMultipliers };
  const N = V3_INGREDIENTS.length;
  const track: Gate[] = [];
  for (let i = 0; i < gateCount; i++) {
    const k = i === 0 ? 0 : r.int(10);
    if (k < 5) track.push(tieredOpGate(r, mulLeft, difficultyTier(i, gateCount)));
    else if (k < 8) {
      const x = r.int(N); const y = (x + 1 + r.int(N - 1)) % N;
      track.push({ kind: "ingredient", lanes: [pick(V3_INGREDIENTS, x), pick(V3_INGREDIENTS, y)] });
    } else track.push({ kind: "negative", spoiled: pick(V3_INGREDIENTS, r.int(N)), spoiledLane: r.int(2) as Lane });
  }
  return track;
}

/* ---------------------------- gate timing ---------------------------- */
/** v3 per-gate interval at the first and last gate for a 30-gate run (ms). */
export const V3_INTERVAL_START_MS = 2100;
export const V3_INTERVAL_END_MS = 1600;

/**
 * Arrival time (ms of gameplay) of each gate at the player. v1/v2: constant
 * (i+1)·(0.92·60 s / n) — unchanged. v3: linear ramp whose 30-gate run goes
 * 2100 ms → 1600 ms (total 55.5 s), scaled for other counts; always < 60 s.
 */
export function gateSchedule(gateCount: number, rulesVersion: number): number[] {
  const out: number[] = [];
  if (rulesVersion !== TIERED_RULES_VERSION) {
    const iv = (GAMEPLAY_DURATION_MS * 0.92) / gateCount;
    for (let i = 0; i < gateCount; i++) out.push((i + 1) * iv);
    return out;
  }
  const mean = (V3_INTERVAL_START_MS + V3_INTERVAL_END_MS) / 2; // 1850
  const base = (GAMEPLAY_DURATION_MS * 0.925) / gateCount; // 1850 at n = 30
  const swing = (V3_INTERVAL_START_MS - mean) / mean; // 0.135
  let t = 0;
  for (let i = 0; i < gateCount; i++) {
    const f = gateCount === 1 ? 0 : 1 - (2 * i) / (gateCount - 1);
    t += base * (1 + swing * f);
    out.push(t);
  }
  return out;
}

/** Continuous track position (gate units) at elapsed ms, from a schedule. */
export function trackPosition(elapsed: number, sched: readonly number[]): number {
  if (!sched.length || elapsed <= 0) return 0;
  let prev = 0;
  for (let i = 0; i < sched.length; i++) {
    const t = sched[i]!;
    if (elapsed < t) return i + (elapsed - prev) / (t - prev);
    prev = t;
  }
  const last = sched.length > 1 ? sched.at(-1)! - sched.at(-2)! : sched[0]!;
  return sched.length + (elapsed - prev) / last;
}

/** Meter delta of one resolved gate (v2). Shared by client preview and server replay. */
export function stepMeter(meter: number, g: Gate, lane: Lane): number {
  if (g.kind === "op") return applyOp(meter, g.lanes[lane]);
  if (g.kind === "ingredient") return clampMeter(meter + METER.ingredient);
  if (g.kind === "negative") return lane === g.spoiledLane ? clampMeter(meter + METER.hazard) : meter;
  throw new Error("math gates are not part of rules v2");
}

export type MeterReplayResult =
  | { valid: true; finalMeter: number; peakMeter: number; gatesPassed: number; ingredients: Ingredient[]; spoiledHits: number; error: null }
  | { valid: false; finalMeter: 0; peakMeter: 0; gatesPassed: 0; error: string };

/**
 * v2 authoritative replay. Same action contract as v1 ({gateIndex, lane, t},
 * strictly in order, once each). Any client meter/score field is ignored.
 */
export function replayDiscountMeter(seed: bigint | number | string, gateCount: number, playerActions: unknown, rulesVersion: number = OPERATION_RULES_VERSION): MeterReplayResult {
  const bad = (error: string): MeterReplayResult => ({ valid: false, finalMeter: 0, peakMeter: 0, gatesPassed: 0, error });
  if (!isMeterRules(rulesVersion)) return bad("unsupported rules version");
  let track: Gate[];
  try { track = rulesVersion === TIERED_RULES_VERSION ? generateTieredTrack(seed, gateCount) : generateOperationTrack(seed, gateCount); } catch (e) { return bad((e as Error).message); }
  if (!Array.isArray(playerActions)) return bad("malformed actions");
  if (playerActions.length > gateCount) return bad("too many actions");
  let meter: number = METER.start, peak: number = METER.start, spoiledHits = 0, lastT = -1;
  const ingredients: Ingredient[] = [];
  for (let i = 0; i < playerActions.length; i++) {
    const a = playerActions[i] as PlayerAction;
    if (!a || typeof a !== "object") return bad("malformed action");
    if (Object.keys(a).sort().join(",") !== "gateIndex,lane,t") return bad("malformed action");
    if (!Number.isInteger(a.gateIndex) || a.gateIndex < 0 || a.gateIndex >= gateCount) return bad("invalid gate index");
    if (a.gateIndex !== i) return bad("impossible gate progression");
    if (a.lane !== 0 && a.lane !== 1) return bad("invalid lane");
    if (!Number.isInteger(a.t) || a.t < 0 || a.t > HARD_CUTOFF_MS || a.t < lastT) return bad("malformed timing");
    lastT = a.t;
    const g = pick(track, i);
    if (g.kind === "ingredient") ingredients.push(g.lanes[a.lane]);
    if (g.kind === "negative" && a.lane === g.spoiledLane) spoiledHits++;
    meter = stepMeter(meter, g, a.lane);
    if (meter > peak) peak = meter;
  }
  return { valid: true, finalMeter: meter, peakMeter: peak, gatesPassed: playerActions.length, ingredients, spoiledHits, error: null };
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
  // v1-only entry point (v2 uses replayDiscountMeter). Keeps the stored-score contract unchanged.
  if (rulesVersion !== RULES_VERSION) return fail("unsupported rules version");
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
    if (g.kind === "op") return fail("operation gate in v1 track");
    if (g.kind === "math") { if (a.lane === g.correctLane) mathCorrect++; else mathWrong++; }
    else if (g.kind === "ingredient") ingredients.push(g.lanes[a.lane]);
    else if (a.lane === g.spoiledLane) spoiledHits++;
  }
  const raw = mathCorrect * PROVISIONAL_SCORE.mathCorrect + ingredients.length * PROVISIONAL_SCORE.ingredient + spoiledHits * PROVISIONAL_SCORE.spoiled;
  return { valid: true, score: Math.max(0, raw), gatesPassed: playerActions.length, mathCorrect, mathWrong, ingredients, spoiledHits, timingAuthoritative: false, error: null };
}

// ---------- Public (client-safe) gate view ----------
/**
 * Visual-only gate data. `correctLane` and the seed are never included. The
 * spoiled lane is visible obstacle info (owner-approved, STEP 46D Gap 2). Intended for a future server response; the server must
 * build it from its own authoritative track.
 */
export type PublicGate =
  | { kind: "math"; a: number; op: MathOp; b: number; lanes: [number, number] }
  | { kind: "ingredient"; lanes: [Ingredient, Ingredient] }
  | { kind: "negative"; spoiled: Ingredient; spoiledLane: Lane }
  | { kind: "op"; lanes: [OpChoice, OpChoice] };

export function sanitizeGates(track: readonly Gate[]): PublicGate[] {
  return track.map((g): PublicGate => {
    if (g.kind === "math") return { kind: "math", a: g.a, op: g.op, b: g.b, lanes: [g.lanes[0], g.lanes[1]] };
    if (g.kind === "ingredient") return { kind: "ingredient", lanes: [g.lanes[0], g.lanes[1]] };
    if (g.kind === "op") return { kind: "op", lanes: [{ ...g.lanes[0] }, { ...g.lanes[1] }] };
    return { kind: "negative", spoiled: g.spoiled, spoiledLane: g.spoiledLane };
  });
}
