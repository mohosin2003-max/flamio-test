import { describe, expect, test } from "bun:test";
import {
  breakStatus, buildReport, expandWeeklyDates, missedClockOuts, overlaps, overlongBreaks, periodKey,
  readFeatureToggles, reportToCsv, rollingCutoff, shiftWindow, validatePlannedBreak,
} from "./attendance-rules.ts";

describe("Dhaka shift windows", () => {
  test("day shift 10:00-18:00 Dhaka is 04:00-12:00 UTC", () => {
    expect(shiftWindow("2026-10-18", "10:00", "18:00")).toEqual({ startAt: "2026-10-18T04:00:00.000Z", endAt: "2026-10-18T12:00:00.000Z", overnight: false });
  });
  test("overnight 22:00-06:00 ends next Dhaka day", () => {
    const w = shiftWindow("2026-10-18", "22:00", "06:00");
    expect(w.overnight).toBe(true);
    expect(w.startAt).toBe("2026-10-18T16:00:00.000Z");
    expect(w.endAt).toBe("2026-10-19T00:00:00.000Z");
  });
  test("Dhaka midnight shift starts previous UTC day", () => {
    expect(shiftWindow("2026-10-18", "00:00", "04:00").startAt).toBe("2026-10-17T18:00:00.000Z");
  });
  test("rejects invalid times and dates", () => {
    expect(() => shiftWindow("2026-02-30", "10:00", "18:00")).toThrow();
    expect(() => shiftWindow("2026-10-18", "25:00", "18:00")).toThrow();
  });
});

describe("weekly expansion", () => {
  test("Sat+Sun across one week", () => {
    expect(expandWeeklyDates("2026-10-17", "2026-10-23", [6, 0])).toEqual(["2026-10-17", "2026-10-18"]);
  });
  test("rejects >62 days, reversed range and no weekdays", () => {
    expect(() => expandWeeklyDates("2026-01-01", "2026-04-01", [1])).toThrow();
    expect(() => expandWeeklyDates("2026-10-20", "2026-10-18", [1])).toThrow();
    expect(() => expandWeeklyDates("2026-10-18", "2026-10-20", [])).toThrow();
  });
});

describe("overlap prevention", () => {
  const a = shiftWindow("2026-10-18", "22:00", "06:00");
  test("overnight shift overlaps next-morning shift", () => {
    expect(overlaps(a, shiftWindow("2026-10-19", "05:00", "09:00"))).toBe(true);
  });
  test("back-to-back shifts do not overlap", () => {
    expect(overlaps(a, shiftWindow("2026-10-19", "06:00", "10:00"))).toBe(false);
  });
});

describe("break limits", () => {
  const start = "2026-10-18T06:00:00.000Z";
  const t = (m) => Date.parse(start) + m * 60000;
  test("within scheduled break", () => { expect(breakStatus(start, t(20), 30)).toMatchObject({ minutes: 20, exceeded: false }); });
  test("exceeded by 5 min", () => { expect(breakStatus(start, t(35), 30)).toMatchObject({ exceeded: true, overBy: 5 }); });
  test("no schedule value -> no invented limit", () => { expect(breakStatus(start, t(500), null)).toMatchObject({ allowanceMinutes: null, exceeded: false }); });
  test("planned break must be shorter than shift", () => {
    const w = shiftWindow("2026-10-18", "10:00", "11:00");
    expect(() => validatePlannedBreak(w.startAt, w.endAt, 60)).toThrow();
    expect(() => validatePlannedBreak(w.startAt, w.endAt, 30)).not.toThrow();
  });
  test("overlongBreaks uses >30 min", () => {
    const r = overlongBreaks([{ id: "a", userId: "u", startedAt: start }, { id: "b", userId: "u", startedAt: new Date(t(10)).toISOString() }], t(31));
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });
  test("missedClockOuts: scheduled grace and unscheduled max", () => {
    const s = [{ id: "s", userId: "u", clockInAt: start, shiftEndsAt: new Date(t(60)).toISOString() }, { id: "n", userId: "u", clockInAt: start, shiftEndsAt: null }];
    expect(missedClockOuts(s, t(91)).map((x) => x.id)).toEqual(["s"]);
    expect(missedClockOuts(s, t(16 * 60 + 1)).map((x) => x.id)).toEqual(["s", "n"]);
  });
});

describe("reports and CSV", () => {
  test("weeks start Saturday", () => {
    expect(periodKey("2026-10-23", "weekly")).toBe("2026-10-17");
    expect(periodKey("2026-10-17", "weekly")).toBe("2026-10-17");
  });
  test("overtime only for scheduled closed sessions", () => {
    const [row] = buildReport([
      { userId: "u", staffName: "A", dutyDate: "2026-10-18", workedMinutes: 500, breakMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, scheduledMinutes: 450, closed: true },
      { userId: "u", staffName: "A", dutyDate: "2026-10-18", workedMinutes: 600, breakMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, scheduledMinutes: null, closed: true },
    ], "daily");
    expect(row.overtimeMinutes).toBe(50);
  });
  test("CSV neutralises formula injection", () => {
    const csv = reportToCsv([{ period: "2026-10-18", userId: "u", staffName: "=HYPERLINK(\"x\")", sessions: 1, openSessions: 0, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, lateCount: 0, overtimeMinutes: 0, scheduledMinutes: 0 }]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const p of ["+1", "-1", "@SUM"]) expect(reportToCsv([{ period: "p", userId: "u", staffName: p, sessions: 0, openSessions: 0, workedMinutes: 0, breakMinutes: 0, lateMinutes: 0, lateCount: 0, overtimeMinutes: 0, scheduledMinutes: 0 }])).toContain(`'${p}`);
  });
});

describe("toggles and retention", () => {
  test("missing columns keep features ON", () => { expect(readFeatureToggles({})).toEqual({ attendanceEnabled: true, tasksEnabled: true }); });
  test("rolling 30 days, never less", () => {
    expect(rollingCutoff(new Date("2026-10-18T00:00:00Z")).toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(() => rollingCutoff(new Date(), 7)).toThrow();
  });
});
