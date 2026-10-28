/**
 * Decides whether the Staff My Duty page shows the red late-arrival banner.
 * Uses only the server-calculated `late_minutes` stored on the session —
 * no second lateness calculation in the browser.
 */
export interface LateNoticeInput {
  isStaffDuty: boolean;
  hasScheduledShift: boolean;
  lateMinutes: number | null | undefined;
}

export function lateNoticeMinutes(input: LateNoticeInput): number | null {
  if (!input.isStaffDuty || !input.hasScheduledShift) return null;
  const m = input.lateMinutes;
  if (typeof m !== "number" || !Number.isFinite(m) || m <= 0) return null;
  return Math.round(m);
}
