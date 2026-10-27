import { describe, expect, test } from "bun:test";
import { buildWeeklyWindows } from "./attendance-rules.ts";

const fallback = { startTime: "10:00", endTime: "18:00", plannedBreakMinutes: 30 };
// 2026-10-30 is Friday(5), 31 Saturday(6), 2026-11-01 Sunday(0)
describe("independent weekday times", () => {
  test("Fri 14-17, Sat 10-22, Sun 10-20 produce matching Dhaka windows", () => {
    const w = buildWeeklyWindows("2026-10-30", "2026-11-01", [5, 6, 0], fallback, {
      5: { startTime: "14:00", endTime: "17:00", plannedBreakMinutes: 0 },
      6: { startTime: "10:00", endTime: "22:00", plannedBreakMinutes: 60 },
      0: { startTime: "10:00", endTime: "20:00", plannedBreakMinutes: 45 },
    });
    expect(w.map((x) => [x.date, x.startTime, x.endTime, x.plannedBreakMinutes])).toEqual([
      ["2026-10-30", "14:00", "17:00", 0], ["2026-10-31", "10:00", "22:00", 60], ["2026-11-01", "10:00", "20:00", 45],
    ]);
    expect(w[0].startAt).toBe("2026-10-30T08:00:00.000Z");
    expect(w[1].endAt).toBe("2026-10-31T16:00:00.000Z");
  });
  test("weekdays without their own times use the shared times", () => {
    const w = buildWeeklyWindows("2026-10-30", "2026-10-31", [5, 6], fallback, { 5: { startTime: "14:00", endTime: "17:00", plannedBreakMinutes: 0 } });
    expect(w[1].startTime).toBe("10:00");
    expect(w[1].endTime).toBe("18:00");
  });
  test("overnight day overlapping next day's start is rejected", () => {
    expect(() => buildWeeklyWindows("2026-10-30", "2026-10-31", [5, 6], fallback, {
      5: { startTime: "20:00", endTime: "12:00", plannedBreakMinutes: 0 },
      6: { startTime: "10:00", endTime: "18:00", plannedBreakMinutes: 0 },
    })).toThrow(/overlap/);
  });
  test("break as long as the shift is rejected", () => {
    expect(() => buildWeeklyWindows("2026-10-30", "2026-10-30", [5], fallback, { 5: { startTime: "14:00", endTime: "15:00", plannedBreakMinutes: 60 } })).toThrow();
  });
  test("invalid time is rejected", () => {
    expect(() => buildWeeklyWindows("2026-10-30", "2026-10-30", [5], fallback, { 5: { startTime: "25:00", endTime: "15:00", plannedBreakMinutes: 0 } })).toThrow();
  });
});
