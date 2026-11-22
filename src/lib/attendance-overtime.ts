/**
 * FLAMIO Attendance — normal duty auto-close and approved overtime rules (pure).
 * The database maintenance function and review RPC apply the same rules
 * server-side; this module is the testable reference and is used by the
 * server functions and reports. All instants are UTC epoch milliseconds.
 */

/** The only overtime durations staff may request (minutes). */
export const OVERTIME_DURATIONS = [30, 60, 90, 120] as const;
export type OvertimeDuration = (typeof OVERTIME_DURATIONS)[number];

export const OVERTIME_LABELS: Record<OvertimeDuration, string> = {
  30: "30 min", 60: "1 hour", 90: "1.5 hours", 120: "2 hours",
};

export const AUTO_CLOSE_NOTE = "auto_closed_normal_duty_end";

export function isAllowedOvertimeMinutes(value: unknown): value is OvertimeDuration {
  return typeof value === "number" && (OVERTIME_DURATIONS as readonly number[]).includes(value);
}

/**
 * Approved overtime window. Approved at/before duty end: starts exactly at
 * duty end. Approved after duty end: starts at the approval time (never
 * backdated). End = start + approved duration.
 */
export function overtimeWindow(p: { dutyEndMs: number; approvedAtMs: number; minutes: number }): { startMs: number; endMs: number; preApproved: boolean } {
  if (!isAllowedOvertimeMinutes(p.minutes)) throw new Error("Invalid overtime duration.");
  if (!Number.isFinite(p.dutyEndMs) || !Number.isFinite(p.approvedAtMs)) throw new Error("Invalid overtime times.");
  const preApproved = p.approvedAtMs <= p.dutyEndMs;
  const startMs = preApproved ? p.dutyEndMs : p.approvedAtMs;
  return { startMs, endMs: startMs + p.minutes * 60000, preApproved };
}

export type OvertimeState = "pending" | "scheduled" | "active" | "completed" | "rejected" | "cancelled";

/** Display / counting state of one overtime request at server time `nowMs`. */
export function overtimeState(r: { status: string; startMs: number | null; endMs: number | null }, nowMs: number): OvertimeState {
  if (r.status === "rejected") return "rejected";
  if (r.status === "cancelled") return "cancelled";
  if (r.status !== "approved" || r.startMs == null || r.endMs == null) return "pending";
  if (nowMs < r.startMs) return "scheduled";
  if (nowMs < r.endMs) return "active";
  return "completed";
}

/** Minutes of overtime that count: only approved windows, only the elapsed part, never more than approved. */
export function countedOvertimeMinutes(r: { status: string; startMs: number | null; endMs: number | null }, nowMs: number): number {
  if (r.status !== "approved" || r.startMs == null || r.endMs == null) return 0;
  const end = Math.min(nowMs, r.endMs);
  return end <= r.startMs ? 0 : Math.floor((end - r.startMs) / 60000);
}

/**
 * Normal attendance close decision. An open session linked to a shift closes
 * at exactly the shift end once server time reaches it. A manual clock-out
 * after the duty end is capped at the duty end (never counted as overtime).
 */
export function normalCloseAt(p: { clockOutMs: number | null; shiftEndMs: number | null; nowMs: number }): { close: boolean; atMs: number | null; auto: boolean } {
  if (p.clockOutMs != null) return { close: false, atMs: p.clockOutMs, auto: false };
  if (p.shiftEndMs == null || p.nowMs < p.shiftEndMs) return { close: false, atMs: null, auto: false };
  return { close: true, atMs: p.shiftEndMs, auto: true };
}

export function manualClockOutAt(nowMs: number, shiftEndMs: number | null): number {
  return shiftEndMs != null && nowMs > shiftEndMs ? shiftEndMs : nowMs;
}
