/**
 * FLAMIO Burger Boost — reward policy (Step 48 approved rules). PURE: no I/O,
 * no database, no clock reads. Used by future server code and by the owner
 * dashboard's draft validation. Nothing here issues a coupon: issuance stays
 * locked (bb_coupons_phase1_locked CHECK(false), awarded_discount_percent = 0).
 *
 * The in-memory allocator is a REFERENCE MODEL for tests and for the SQL draft
 * (docs/burger-boost/drafts/). Real enforcement must be one atomic database
 * transaction — never this function or any client/application counter.
 */

export const DHAKA_TZ = "Asia/Dhaka";
export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000; // Asia/Dhaka is fixed UTC+6 (no DST)
export const COUPON_VALIDITY_DAYS = 7;
export const COUPON_VALIDITY_MS = COUPON_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
export const REWARD_ATTEMPTS_PER_DAY = 1;

/** Safe configured bounds for owner settings. */
export const REWARD_BOUNDS = {
  maxDiscount: { min: 0, max: 50 },
  winnersPerDay: { min: 0, max: 1000 },
  minOrderBdt: { min: 0, max: 100_000 },
  gateCount: { min: 10, max: 60, default: 30 },
} as const;

export type SessionMode = "practice" | "reward";

/** Asia/Dhaka calendar date (YYYY-MM-DD) for an epoch-ms instant. */
export function dhakaDate(epochMs: number): string {
  if (!Number.isFinite(epochMs)) throw new Error("invalid time");
  return new Date(epochMs + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);

/** FullDiscount = floor(OwnerMax × clamp(FinalMeter, 0, 100) / 100). */
export function fullDiscount(ownerMax: number, finalMeter: number): number {
  if (!isInt(ownerMax) || ownerMax < 0 || !Number.isFinite(finalMeter)) return 0;
  return Math.floor((ownerMax * clamp(Math.trunc(finalMeter), 0, 100)) / 100);
}
/** PartialDiscount = floor(PartialMax × clamp(FinalMeter, 0, 100) / 100). */
export function partialDiscount(partialMax: number, finalMeter: number): number {
  return fullDiscount(partialMax, finalMeter);
}

export type RewardSettings = {
  ownerMax: number; partialMax: number;
  dailyFullLimit: number; dailyPartialLimit: number;
  minOrderBdt: number; gateCount: number;
};

export type SettingsCheck = { ok: true; settings: RewardSettings } | { ok: false; errors: string[] };

/** Server-side validation for every owner update (also mirrored in the dashboard). */
export function validateRewardSettings(input: unknown): SettingsCheck {
  const errors: string[] = [];
  const o = (input ?? {}) as Record<string, unknown>;
  const keys = ["ownerMax", "partialMax", "dailyFullLimit", "dailyPartialLimit", "minOrderBdt", "gateCount"] as const;
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["Settings are missing."] };
  for (const k of Object.keys(o)) if (!(keys as readonly string[]).includes(k)) errors.push(`Unknown setting: ${k}`);
  for (const k of keys) if (!isInt(o[k])) errors.push(`${k} must be a whole number.`);
  if (errors.length) return { ok: false, errors };
  const s = o as unknown as RewardSettings;
  const B = REWARD_BOUNDS;
  if (s.ownerMax < B.maxDiscount.min || s.ownerMax > B.maxDiscount.max) errors.push(`Owner max must be ${B.maxDiscount.min}–${B.maxDiscount.max}%.`);
  if (s.partialMax < B.maxDiscount.min || s.partialMax > B.maxDiscount.max) errors.push(`Partial max must be ${B.maxDiscount.min}–${B.maxDiscount.max}%.`);
  if (s.partialMax > s.ownerMax) errors.push("Partial max can't be higher than owner max.");
  for (const k of ["dailyFullLimit", "dailyPartialLimit"] as const)
    if (s[k] < B.winnersPerDay.min || s[k] > B.winnersPerDay.max) errors.push(`${k} must be ${B.winnersPerDay.min}–${B.winnersPerDay.max}.`);
  if (s.minOrderBdt < B.minOrderBdt.min || s.minOrderBdt > B.minOrderBdt.max) errors.push(`Minimum order must be ${B.minOrderBdt.min}–${B.minOrderBdt.max} BDT.`);
  if (s.gateCount < B.gateCount.min || s.gateCount > B.gateCount.max) errors.push(`Gate count must be ${B.gateCount.min}–${B.gateCount.max}.`);
  return errors.length ? { ok: false, errors } : { ok: true, settings: { ...s } };
}

/* ------------------------- daily attempt policy -------------------------- */

export type AttemptLedger = Map<string, Set<string>>; // dhakaDate -> userIds that consumed
export type AttemptDecision = { allowed: true; date: string } | { allowed: false; reason: "attempt_used"; date: string };

/** Practice is always allowed and never touches the ledger. */
export function canStartReward(ledger: AttemptLedger, userId: string, nowMs: number): AttemptDecision {
  const date = dhakaDate(nowMs);
  return ledger.get(date)?.has(userId) ? { allowed: false, reason: "attempt_used", date } : { allowed: true, date };
}

/**
 * Consumed only after the server successfully created a valid reward session.
 * Loss/timeout/exit/disconnect afterwards keep it consumed. A verified
 * server-side failure BEFORE a valid start passes `sessionCreated: false`
 * and consumes nothing. Client claims never restore an attempt.
 */
export function recordRewardStart(ledger: AttemptLedger, userId: string, nowMs: number, sessionCreated: boolean): boolean {
  if (!sessionCreated) return false;
  const date = dhakaDate(nowMs);
  const set = ledger.get(date) ?? new Set<string>();
  if (set.has(userId)) return false; // duplicate request → no extra attempt
  set.add(userId); ledger.set(date, set);
  return true;
}

/* -------------------- reference daily winner allocator -------------------- */

export type DailyUsage = { date: string; fullUsed: number; partialUsed: number };
export type Allocation =
  | { tier: "full" | "partial"; discountPercent: number; expiresAt: number }
  | { tier: "none"; discountPercent: 0; reason: "loss" | "practice" | "quota_exhausted" | "zero_discount" };

/**
 * Full slots first, then Partial, then none. Zero/negative meter = loss and
 * consumes no slot. A computed 0% discount creates no coupon and no slot.
 * Mutates `usage` only when a slot is actually granted.
 */
export function allocateReward(usage: DailyUsage, s: RewardSettings, mode: SessionMode, finalMeter: number, nowMs: number): Allocation {
  if (mode !== "reward") return { tier: "none", discountPercent: 0, reason: "practice" };
  if (!Number.isFinite(finalMeter) || finalMeter <= 0) return { tier: "none", discountPercent: 0, reason: "loss" };
  if (usage.date !== dhakaDate(nowMs)) { usage.date = dhakaDate(nowMs); usage.fullUsed = 0; usage.partialUsed = 0; }
  const expiresAt = nowMs + COUPON_VALIDITY_MS;
  if (usage.fullUsed < s.dailyFullLimit) {
    const d = fullDiscount(s.ownerMax, finalMeter);
    if (d <= 0) return { tier: "none", discountPercent: 0, reason: "zero_discount" };
    usage.fullUsed++;
    return { tier: "full", discountPercent: Math.min(d, s.ownerMax), expiresAt };
  }
  if (usage.partialUsed < s.dailyPartialLimit) {
    const d = partialDiscount(s.partialMax, finalMeter);
    if (d <= 0) return { tier: "none", discountPercent: 0, reason: "zero_discount" };
    usage.partialUsed++;
    return { tier: "partial", discountPercent: Math.min(d, s.partialMax), expiresAt };
  }
  return { tier: "none", discountPercent: 0, reason: "quota_exhausted" };
}

/* ------------------------- coupon validation model ------------------------ */

export type CouponView = { userId: string; discountPercent: number; issuedAt: number; expiresAt: number; usedAt: number | null };
export type CouponCheck = { ok: true } | { ok: false; reason: "wrong_user" | "expired" | "used" | "below_minimum" | "stacking" | "invalid" };

/** Checkout-side checks (future). Must run on the server inside the order transaction. */
export function checkCoupon(c: CouponView, userId: string, orderTotalBdt: number, minOrderBdt: number, otherCouponsApplied: number, nowMs: number): CouponCheck {
  if (!c || !isInt(c.discountPercent) || c.discountPercent <= 0 || c.expiresAt !== c.issuedAt + COUPON_VALIDITY_MS) return { ok: false, reason: "invalid" };
  if (c.userId !== userId) return { ok: false, reason: "wrong_user" };
  if (c.usedAt !== null) return { ok: false, reason: "used" };
  if (nowMs >= c.expiresAt) return { ok: false, reason: "expired" };
  if (otherCouponsApplied > 0) return { ok: false, reason: "stacking" };
  if (!(orderTotalBdt >= minOrderBdt)) return { ok: false, reason: "below_minimum" };
  return { ok: true };
}
