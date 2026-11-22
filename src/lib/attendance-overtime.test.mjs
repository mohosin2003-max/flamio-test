import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OVERTIME_DURATIONS, isAllowedOvertimeMinutes, overtimeWindow, overtimeState, countedOvertimeMinutes, normalCloseAt, manualClockOutAt } from "./attendance-overtime.ts";
import { buildReport } from "./attendance-rules.ts";

const T = (hhmm) => Date.parse(`2026-11-22T${hhmm}:00+06:00`);
const END = T("21:00");
const H = 3600000, M = 60000;

describe("normal attendance auto-close", () => {
  test("no clock-out: closes exactly at duty end", () => {
    expect(normalCloseAt({ clockOutMs: null, shiftEndMs: END, nowMs: END })).toEqual({ close: true, atMs: END, auto: true });
  });
  test("job running late still closes at duty end, not later", () => {
    expect(normalCloseAt({ clockOutMs: null, shiftEndMs: END, nowMs: END + 2 * H }).atMs).toBe(END);
  });
  test("before duty end stays open", () => {
    expect(normalCloseAt({ clockOutMs: null, shiftEndMs: END, nowMs: END - M }).close).toBe(false);
  });
  test("manual clock-out at 8:30 PM is never overwritten", () => {
    expect(normalCloseAt({ clockOutMs: T("20:30"), shiftEndMs: END, nowMs: END + H })).toEqual({ close: false, atMs: T("20:30"), auto: false });
  });
  test("late manual clock-out is capped at duty end", () => {
    expect(manualClockOutAt(END + 5 * M, END)).toBe(END);
    expect(manualClockOutAt(T("20:30"), END)).toBe(T("20:30"));
  });
});

describe("overtime durations", () => {
  test("only 30, 60, 90, 120 minutes", () => {
    expect([...OVERTIME_DURATIONS]).toEqual([30, 60, 90, 120]);
    for (const m of [30, 60, 90, 120]) expect(isAllowedOvertimeMinutes(m)).toBe(true);
    for (const m of [10, 15, 45, 180, 0, -30, "60", null]) expect(isAllowedOvertimeMinutes(m)).toBe(false);
    expect(() => overtimeWindow({ dutyEndMs: END, approvedAtMs: END, minutes: 15 })).toThrow();
  });
});

describe("pre-approved overtime", () => {
  test("approved 8:15 PM for 1 hour runs 9:00 → 10:00 PM", () => {
    const w = overtimeWindow({ dutyEndMs: END, approvedAtMs: T("20:15"), minutes: 60 });
    expect(w).toEqual({ startMs: END, endMs: T("22:00"), preApproved: true });
  });
  for (const [m, end] of [[30, "21:30"], [60, "22:00"], [90, "22:30"], [120, "23:00"]]) {
    test(`${m} min auto-closes at ${end}`, () => {
      expect(overtimeWindow({ dutyEndMs: END, approvedAtMs: T("20:30"), minutes: m }).endMs).toBe(T(end));
    });
  }
  test("no gap and no overlap at duty end", () => {
    const w = overtimeWindow({ dutyEndMs: END, approvedAtMs: T("20:30"), minutes: 60 });
    expect(w.startMs).toBe(normalCloseAt({ clockOutMs: null, shiftEndMs: END, nowMs: END }).atMs);
  });
});

describe("post-end overtime", () => {
  test("approved 9:07 PM for 30 min runs 9:07 → 9:37 PM, not backdated", () => {
    const w = overtimeWindow({ dutyEndMs: END, approvedAtMs: T("21:07"), minutes: 30 });
    expect(w).toEqual({ startMs: T("21:07"), endMs: T("21:37"), preApproved: false });
  });
  test("approved 9:10 PM for 1 hour ends 10:10 PM", () => {
    expect(overtimeWindow({ dutyEndMs: END, approvedAtMs: T("21:10"), minutes: 60 }).endMs).toBe(T("22:10"));
  });
});

describe("counting", () => {
  const w = { status: "approved", startMs: END, endMs: T("22:00") };
  test("pending, rejected, cancelled count zero", () => {
    for (const status of ["pending", "rejected", "cancelled"]) expect(countedOvertimeMinutes({ status, startMs: END, endMs: T("22:00") }, T("23:00"))).toBe(0);
  });
  test("approved counts only the approved duration", () => {
    expect(countedOvertimeMinutes(w, T("23:59"))).toBe(60);
    expect(countedOvertimeMinutes(w, T("21:20"))).toBe(20);
    expect(countedOvertimeMinutes(w, T("20:59"))).toBe(0);
  });
  test("state transitions", () => {
    expect(overtimeState(w, T("20:50"))).toBe("scheduled");
    expect(overtimeState(w, END)).toBe("active");
    expect(overtimeState(w, T("22:00"))).toBe("completed");
    expect(overtimeState({ status: "pending", startMs: null, endMs: null }, END)).toBe("pending");
  });
  test("report overtime is the approved overtime only, not worked minus scheduled", () => {
    const [row] = buildReport([
      { userId: "u", staffName: "A", dutyDate: "2026-11-22", workedMinutes: 900, breakMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, scheduledMinutes: 600, closed: true },
    ], "daily");
    expect(row.overtimeMinutes).toBe(0);
  });
});

describe("server enforcement (source + migration)", () => {
  const fn = readFileSync(new URL("./attendance-workflow.functions.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../../supabase/migrations/20261122060000_attendance_duty_autoclose_overtime.sql", import.meta.url), "utf8");
  test("request validation uses the four-duration whitelist", () => {
    expect(fn).toContain("isAllowedOvertimeMinutes(v.requestedOvertimeMinutes)");
  });
  test("database check restricts new overtime durations", () => {
    expect(sql).toMatch(/requested_overtime_minutes IN \(30, 60, 90, 120\)/);
  });
  test("normal close and overtime close are conditional (idempotent, race safe)", () => {
    expect(sql).toMatch(/clock_out_at IS NULL/);
    expect(sql).toMatch(/overtime_completed_at IS NULL/);
    expect(sql).toMatch(/overtime_starts_at IS NULL/);
  });
  test("pre vs post approval start rule in SQL", () => {
    expect(sql).toMatch(/CASE WHEN v_req\.reviewed_at <= v_end THEN v_end ELSE v_req\.reviewed_at END/);
  });
  test("maintenance and scheduling RPCs are service-role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.attendance_run_duty_maintenance\(\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.attendance_schedule_overtime\(uuid\) FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO (anon|authenticated)/);
  });
  test("migration does not touch photo evidence or production", () => {
    expect(sql).not.toMatch(/selfie|attendance-evidence|wubsldblxvkusauafwfd\b(?![^\n]*out of scope)/i);
  });
  test("dispatcher runs the duty maintenance", () => {
    const d = readFileSync(new URL("../routes/api/public/notifications/dispatch.ts", import.meta.url), "utf8");
    expect(d).toContain("attendance_run_duty_maintenance");
  });
});
