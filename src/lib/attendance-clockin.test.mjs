import { describe, expect, test } from "bun:test";
import { addCalendarDays, dhakaDateKey, isShiftVisibleToStaff, shiftClockInEligibility } from "./attendance-rules.ts";

const ME = "user-a";
const at = (iso) => Date.parse(iso);
// Day shift 2026-10-21 10:00-18:00 Dhaka = 04:00-12:00 UTC
const day = { user_id: ME, shift_date: "2026-10-21", starts_at: "2026-10-21T04:00:00.000Z", ends_at: "2026-10-21T12:00:00.000Z", status: "scheduled", is_overnight: false };
// Overnight 2026-10-21 22:00 -> 2026-10-22 06:00 Dhaka = 16:00Z -> 00:00Z
const night = { user_id: ME, shift_date: "2026-10-21", starts_at: "2026-10-21T16:00:00.000Z", ends_at: "2026-10-22T00:00:00.000Z", status: "scheduled", is_overnight: true };

describe("staff clock-in eligibility", () => {
  test("normal same-day shift", () => {
    expect(shiftClockInEligibility(day, ME, at("2026-10-21T04:05:00Z"), 15).ok).toBe(true);
  });
  test("early-clock-in boundary", () => {
    expect(shiftClockInEligibility(day, ME, at("2026-10-21T03:45:00Z"), 15).ok).toBe(true);
    expect(shiftClockInEligibility(day, ME, at("2026-10-21T03:44:59Z"), 15)).toEqual({ ok: false, reason: "It is too early to clock in for this shift." });
  });
  test("future-dated shift rejected", () => {
    const future = { ...day, shift_date: "2026-10-25", starts_at: "2026-10-25T04:00:00.000Z", ends_at: "2026-10-25T12:00:00.000Z" };
    expect(shiftClockInEligibility(future, ME, at("2026-10-21T04:05:00Z"), 15).ok).toBe(false);
  });
  test("overnight shift visible and eligible after midnight", () => {
    const afterMidnight = at("2026-10-21T18:15:00Z"); // 00:15 Dhaka on 22 Oct
    expect(dhakaDateKey(afterMidnight)).toBe("2026-10-22");
    expect(isShiftVisibleToStaff(night, afterMidnight)).toBe(true);
    expect(shiftClockInEligibility(night, ME, afterMidnight, 15).ok).toBe(true);
  });
  test("overnight shift not visible or eligible after ends_at", () => {
    const later = at("2026-10-22T00:01:00Z");
    expect(isShiftVisibleToStaff(night, later)).toBe(false);
    expect(shiftClockInEligibility(night, ME, later, 15).ok).toBe(false);
    expect(isShiftVisibleToStaff({ ...day, shift_date: "2026-10-21" }, at("2026-10-21T19:00:00Z"))).toBe(false);
  });
  test("shift-end boundary", () => {
    expect(shiftClockInEligibility(day, ME, at("2026-10-21T12:00:00Z"), 15).ok).toBe(true);
    expect(shiftClockInEligibility(day, ME, at("2026-10-21T12:00:01Z"), 15)).toEqual({ ok: false, reason: "This shift has already ended." });
  });
  test("another staff member's shift rejected", () => {
    expect(shiftClockInEligibility({ ...day, user_id: "user-b" }, ME, at("2026-10-21T04:05:00Z"), 15).ok).toBe(false);
  });
  test("non-scheduled shift rejected", () => {
    expect(shiftClockInEligibility({ ...day, status: "cancelled" }, ME, at("2026-10-21T04:05:00Z"), 15).ok).toBe(false);
  });
  test("early arrival across midnight for a 00:00 shift", () => {
    const mid = { user_id: ME, shift_date: "2026-10-22", starts_at: "2026-10-21T18:00:00.000Z", ends_at: "2026-10-22T02:00:00.000Z", status: "scheduled", is_overnight: false };
    expect(shiftClockInEligibility(mid, ME, at("2026-10-21T17:50:00Z"), 15).ok).toBe(true);
  });
  test("Dhaka-local date rollover", () => {
    expect(dhakaDateKey(at("2026-10-21T17:59:59Z"))).toBe("2026-10-21");
    expect(dhakaDateKey(at("2026-10-21T18:00:00Z"))).toBe("2026-10-22");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addCalendarDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addCalendarDays("2027-01-01", -1)).toBe("2026-12-31");
  });
});
