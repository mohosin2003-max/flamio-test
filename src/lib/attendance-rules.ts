/**
 * FLAMIO ATTENDANCE MASTER — additional pure rules (no I/O).
 * Recurring shifts, break/clock-out issue detection, period reports, CSV,
 * feature toggles and rolling-day retention. Server code is authoritative;
 * the UI uses these only for display.
 */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/* --------------------------- Feature toggles ---------------------------- */

export interface FeatureToggles {
  attendanceEnabled: boolean;
  tasksEnabled: boolean;
}

/**
 * Reads independent toggles from a settings row. Columns that do not exist yet
 * (migration not applied) keep the feature ON so existing behaviour is unchanged.
 */
export function readFeatureToggles(row: Record<string, unknown> | null | undefined): FeatureToggles {
  return {
    attendanceEnabled: row?.["attendance_enabled"] !== false,
    tasksEnabled: row?.["tasks_enabled"] !== false,
  };
}

/* --------------------------- Recurring shifts --------------------------- */

function parseDate(key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid date.");
  const t = Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  if (new Date(t).toISOString().slice(0, 10) !== key) throw new Error("Invalid date.");
  return t;
}

/**
 * Calendar dates between from..to (inclusive) whose weekday (0=Sun..6=Sat) is
 * selected. Dates are Asia/Dhaka calendar dates. Capped to 62 days.
 */
export function expandWeeklyDates(from: string, to: string, weekdays: number[]): string[] {
  const start = parseDate(from);
  const end = parseDate(to);
  if (end < start) throw new Error("End date must be on or after the start date.");
  if ((end - start) / DAY_MS > 62) throw new Error("Recurring schedules can cover at most 62 days at a time.");
  const days = new Set(weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6));
  if (!days.size) throw new Error("Choose at least one weekday.");
  const out: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) {
    if (days.has(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Dhaka wall-clock shift -> UTC instants; end <= start means next day. */
export function shiftWindow(date: string, start: string, end: string) {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (!re.test(s) || !re.test(e)) throw new Error("Invalid shift time.");
  const base = parseDate(date);
  const toUtc = (dayBase: number, hhmm: string) =>
    dayBase + (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))) * 60000 - DHAKA_OFFSET_MS;
  const overnight = e <= s;
  const startAt = toUtc(base, s);
  const endAt = toUtc(overnight ? base + DAY_MS : base, e);
  if (endAt - startAt > 18 * 3600000) throw new Error("A shift cannot exceed 18 hours.");
  return { startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), overnight };
}

export function validatePlannedBreak(startAt: string, endAt: string, breakMinutes: number) {
  const length = (Date.parse(endAt) - Date.parse(startAt)) / 60000;
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) throw new Error("Break minutes must be zero or more.");
  if (breakMinutes >= length) throw new Error("Planned break cannot be as long as the shift.");
}

export function overlaps(a: { startAt: string; endAt: string }, b: { startAt: string; endAt: string }) {
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
}

/* ---------------------------- Issue detection --------------------------- */

export interface OpenBreak { id: string; userId: string; startedAt: string; scheduledAllowanceMinutes?: number | null }
export interface OpenSession { id: string; userId: string; clockInAt: string; shiftEndsAt: string | null }

/** Fallback used only when no scheduled break value exists. */
export const UNSCHEDULED_BREAK_ESTIMATE_MINUTES = 30;

export type BreakAlertKind = "scheduled_exceeded" | "unscheduled_estimate";

/**
 * Breaks still open past their limit. A break whose shift has a planned
 * break > 0 uses that real limit ("scheduled_exceeded"); otherwise the
 * 30-minute estimate applies and is labelled as an estimate.
 */
export function overlongBreaks(breaks: OpenBreak[], now: number, fallbackMinutes = UNSCHEDULED_BREAK_ESTIMATE_MINUTES) {
  return breaks
    .map((b) => {
      const minutes = Math.floor((now - Date.parse(b.startedAt)) / 60000);
      const scheduled = b.scheduledAllowanceMinutes != null && b.scheduledAllowanceMinutes > 0;
      const limitMinutes = scheduled ? Number(b.scheduledAllowanceMinutes) : fallbackMinutes;
      const kind: BreakAlertKind = scheduled ? "scheduled_exceeded" : "unscheduled_estimate";
      return { ...b, minutes, limitMinutes, overBy: Math.max(0, minutes - limitMinutes), kind };
    })
    .filter((b) => b.minutes > b.limitMinutes);
}

/**
 * Open sessions that look like a missed clock-out: past shift end + grace,
 * or (unscheduled) past the maximum session length.
 */
export function missedClockOuts(sessions: OpenSession[], now: number, graceMinutes = 30, maxSessionHours = 16) {
  return sessions.filter((s) => {
    if (s.shiftEndsAt) return now > Date.parse(s.shiftEndsAt) + graceMinutes * 60000;
    return now > Date.parse(s.clockInAt) + maxSessionHours * 3600000;
  });
}

/** Stable key so the same alert is never sent twice for the same record. */
export function alertDedupeKey(kind: "overlong_break" | "missed_clock_out", id: string) {
  return `attendance:${kind}:${id}`;
}

/* -------------------------------- Reports ------------------------------- */

export type ReportPeriod = "daily" | "weekly" | "monthly";

/** Bucket label for a Dhaka duty date. Weeks start Saturday (Bangladesh). */
export function periodKey(dutyDate: string, period: ReportPeriod): string {
  if (period === "daily") return dutyDate;
  if (period === "monthly") return dutyDate.slice(0, 7);
  const t = parseDate(dutyDate);
  const back = (new Date(t).getUTCDay() + 1) % 7; // Sat=0
  return new Date(t - back * DAY_MS).toISOString().slice(0, 10);
}

export interface ReportSession {
  userId: string;
  staffName: string;
  dutyDate: string;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  scheduledMinutes: number | null;
  closed: boolean;
}

export interface ReportRow {
  period: string;
  userId: string;
  staffName: string;
  sessions: number;
  openSessions: number;
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  lateCount: number;
  /** Only counted for sessions linked to a schedule; unscheduled time is never overtime. */
  overtimeMinutes: number;
  scheduledMinutes: number;
}

export function buildReport(rows: ReportSession[], period: ReportPeriod): ReportRow[] {
  const map = new Map<string, ReportRow>();
  for (const r of rows) {
    const p = periodKey(r.dutyDate, period);
    const key = `${p}|${r.userId}`;
    const cur = map.get(key) ?? {
      period: p, userId: r.userId, staffName: r.staffName, sessions: 0, openSessions: 0,
      workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, lateCount: 0, overtimeMinutes: 0, scheduledMinutes: 0,
    };
    cur.sessions += 1;
    if (!r.closed) cur.openSessions += 1;
    if (r.closed) {
      cur.workedMinutes += Math.max(0, r.workedMinutes);
      cur.breakMinutes += Math.max(0, r.breakMinutes);
    }
    cur.lateMinutes += Math.max(0, r.lateMinutes);
    if (r.lateMinutes > 0) cur.lateCount += 1;
    if (r.scheduledMinutes != null && r.closed) {
      cur.scheduledMinutes += r.scheduledMinutes;
      cur.overtimeMinutes += Math.max(0, r.workedMinutes - r.scheduledMinutes);
    }
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.period.localeCompare(a.period) || a.staffName.localeCompare(b.staffName));
}

function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function reportToCsv(rows: ReportRow[]): string {
  const header = ["Period", "Staff", "Sessions", "Open sessions", "Worked minutes", "Break minutes", "Late minutes", "Late count", "Scheduled minutes", "Overtime minutes"];
  const lines = rows.map((r) => [r.period, r.staffName, r.sessions, r.openSessions, r.workedMinutes, r.breakMinutes, r.lateMinutes, r.lateCount, r.scheduledMinutes, r.overtimeMinutes].map(csvCell).join(","));
  return [header.join(","), ...lines].join("\r\n");
}

/* ------------------------------- Retention ------------------------------ */

/** Rolling cutoff: now minus N days (never "first day of month"). */
export function rollingCutoff(now: Date, days = 30): Date {
  if (!Number.isInteger(days) || days < 30) throw new Error("Retention must be at least 30 days.");
  return new Date(now.getTime() - days * DAY_MS);
}

export interface RetentionSession { id: string; clockOutAt: string | null; status: string; verificationStatus: string }

/**
 * Closed sessions older than the cutoff. Excludes: open sessions, records still
 * awaiting Owner review (auto_closed / disputed / unverified flags).
 */
export function retentionEligibleSessions<T extends RetentionSession>(rows: T[], cutoff: Date): T[] {
  return rows.filter((r) =>
    r.clockOutAt !== null &&
    Date.parse(r.clockOutAt) < cutoff.getTime() &&
    r.status !== "open" &&
    r.status !== "auto_closed" &&
    r.verificationStatus !== "disputed",
  );
}

/* ---------------------------- Opening/closing --------------------------- */

export const STORE_CHECKLISTS = {
  opening: {
    title: "Store opening checklist",
    items: ["Unlock and inspect entrance", "Lights, fans and AC on", "Kitchen equipment and gas checked", "Fridge/freezer temperatures checked", "Counter cash float counted", "Dining area and washroom clean"],
  },
  closing: {
    title: "Store closing checklist",
    items: ["Kitchen equipment and gas off", "Food stored and labelled", "Counter cash counted and secured", "Waste removed", "Floors and surfaces cleaned", "Lights off, doors and shutters locked"],
  },
} as const;

export type StoreChecklistKind = keyof typeof STORE_CHECKLISTS;

/* ------------------------- Staff break warning -------------------------- */

/**
 * Break state for the staff screen. `allowanceMinutes` must come from the
 * scheduled shift's planned break; null means no schedule value exists and
 * no limit is invented.
 */
export function breakStatus(startedAt: string, now: number, allowanceMinutes: number | null) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 60000));
  if (allowanceMinutes == null || allowanceMinutes <= 0) return { minutes, allowanceMinutes: null, overBy: 0, exceeded: false };
  const overBy = Math.max(0, minutes - allowanceMinutes);
  return { minutes, allowanceMinutes, overBy, exceeded: overBy > 0 };
}

/* --------------------- Checklist customization & tasks ------------------ */

export const CHECKLIST_ITEM_MAX = 30;
export const CHECKLIST_LABEL_MAX = 160;

/** Trim, drop blanks, de-duplicate (case-insensitive) and enforce limits. */
export function normalizeChecklistItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const label = raw.trim().replace(/\s+/g, " ");
    if (!label) continue;
    if (label.length > CHECKLIST_LABEL_MAX) throw new Error(`Checklist items must be ${CHECKLIST_LABEL_MAX} characters or fewer.`);
    const k = label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(label);
  }
  if (!out.length) throw new Error("Add at least one checklist item.");
  if (out.length > CHECKLIST_ITEM_MAX) throw new Error(`A checklist can have at most ${CHECKLIST_ITEM_MAX} items.`);
  return out;
}

/** Statuses whose task details may still be edited or disabled. Closed tasks keep their history untouched. */
export const EDITABLE_TASK_STATUSES = ["pending", "in_progress", "rejected"] as const;
export function canEditTask(status: string): boolean {
  return (EDITABLE_TASK_STATUSES as readonly string[]).includes(status);
}

const OPEN_TASK_STATUSES = ["pending", "in_progress", "rejected"];

export type IncompleteTaskInput = { id: string; status: string; dueDate: string; dueAt: string | null; totalItems: number; doneItems: number };
export type IncompleteTaskFlag = IncompleteTaskInput & { reason: "overdue" | "due_today" };

/**
 * Open tasks that are overdue (due time passed, or due date before today in
 * Dhaka) or due today. Completed/verified/cancelled tasks are never flagged.
 */
export function incompleteTasks(tasks: readonly IncompleteTaskInput[], now: number, todayKey: string): IncompleteTaskFlag[] {
  const out: IncompleteTaskFlag[] = [];
  for (const t of tasks) {
    if (!OPEN_TASK_STATUSES.includes(t.status)) continue;
    const overdue = t.dueAt ? Date.parse(t.dueAt) < now : t.dueDate < todayKey;
    if (overdue) out.push({ ...t, reason: "overdue" });
    else if (t.dueDate === todayKey) out.push({ ...t, reason: "due_today" });
  }
  return out;
}

/** Count captured selfies per report row key (`period|userId`). */
export function selfieCountsByRow(rows: readonly { userId: string; dutyDate: string; hasSelfie: boolean }[], period: ReportPeriod): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = `${periodKey(r.dutyDate, period)}|${r.userId}`;
    out[k] = (out[k] ?? 0) + (r.hasSelfie ? 1 : 0);
  }
  return out;
}
