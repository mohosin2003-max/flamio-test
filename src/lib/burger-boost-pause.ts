/**
 * Client-only arcade pause clock. Elapsed gameplay time excludes every paused
 * interval, so gates, timer and meter freeze while paused and resume exactly
 * where they stopped. Does not affect server session expiry.
 */
export type PauseClock = {
  readonly paused: boolean;
  pause(now: number): void;
  resume(now: number): void;
  elapsed(now: number): number;
};

export function createPauseClock(startAt: number): PauseClock {
  let pausedAt: number | null = null;
  let pausedTotal = 0;
  return {
    get paused() { return pausedAt !== null; },
    pause(now) { if (pausedAt === null) pausedAt = now; },
    resume(now) { if (pausedAt !== null) { pausedTotal += Math.max(0, now - pausedAt); pausedAt = null; } },
    elapsed(now) { return Math.max(0, (pausedAt ?? now) - startAt - pausedTotal); },
  };
}

/** Player-facing store discount: same clamp as the reward calculator (meter 0..100 → owner max). */
export function storeDiscountPreview(ownerMax: number, meter: number): number {
  if (!Number.isInteger(ownerMax) || ownerMax <= 0 || !Number.isFinite(meter)) return 0;
  return Math.floor((ownerMax * Math.max(0, Math.min(100, Math.trunc(meter)))) / 100);
}

/** Floating gate feedback in BOOST units, e.g. "+12 BOOST" / "−15 BOOST". */
export function boostDelta(d: number): string {
  return `${d >= 0 ? "+" : "−"}${Math.abs(d)} BOOST`;
}

/** In-game STORE DISCOUNT display: the cumulative gameplay meter, never below 0. Visual only — not the awarded discount. */
export function gameplayDiscountDisplay(meter: number): number {
  return Number.isFinite(meter) ? Math.max(0, Math.trunc(meter)) : 0;
}
