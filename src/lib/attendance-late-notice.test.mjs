import { describe, expect, test } from "bun:test";
import { lateNoticeMinutes } from "./attendance-late-notice.ts";

const base = { isStaffDuty: true, hasScheduledShift: true };

describe("late arrival notice", () => {
  test("late staff sees minutes", () => expect(lateNoticeMinutes({ ...base, lateMinutes: 17 })).toBe(17));
  test("on time shows nothing", () => expect(lateNoticeMinutes({ ...base, lateMinutes: 0 })).toBeNull());
  test("early (negative) shows nothing", () => expect(lateNoticeMinutes({ ...base, lateMinutes: -5 })).toBeNull());
  test("missing late value shows nothing", () => expect(lateNoticeMinutes({ ...base, lateMinutes: null })).toBeNull());
  test("no scheduled shift shows nothing", () => expect(lateNoticeMinutes({ ...base, hasScheduledShift: false, lateMinutes: 20 })).toBeNull());
  test("Owner/Manager/Customer never see it", () => expect(lateNoticeMinutes({ ...base, isStaffDuty: false, lateMinutes: 20 })).toBeNull());
});
