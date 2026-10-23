import { describe, expect, test } from "bun:test";
import { filterUpcomingShifts, findOverlapExcluding, isShiftOverlapConstraintError, shiftEditEligibility, upcomingShiftRange } from "./attendance-rules.ts";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-10-23T16:00:00Z"); // 23 Oct 22:00 Dhaka
const row = (id, user_id, shift_date, status = "scheduled") => ({ id, user_id, shift_date, status, starts_at: `${shift_date}T03:00:00Z` });

describe("staff upcoming shifts", () => {
  test("window is tomorrow through +14 Dhaka days", () => {
    expect(upcomingShiftRange(now)).toEqual({ from: "2026-10-24", to: "2026-11-06" });
  });
  test("Dhaka rollover: 18:30 UTC is already the next Dhaka day", () => {
    expect(upcomingShiftRange(Date.parse("2026-10-23T18:30:00Z")).from).toBe("2026-10-25");
  });
  test("another staff member's shifts are never returned", () => {
    const out = filterUpcomingShifts([row("1", A, "2026-10-25"), row("2", B, "2026-10-25")], A, now);
    expect(out.map((s) => s.id)).toEqual(["1"]);
  });
  test("today, past and beyond-14-day shifts are excluded", () => {
    const out = filterUpcomingShifts([row("t", A, "2026-10-23"), row("p", A, "2026-10-20"), row("f", A, "2026-11-07"), row("e", A, "2026-11-06")], A, now);
    expect(out.map((s) => s.id)).toEqual(["e"]);
  });
  test("cancelled shifts hidden, on-leave shown, sorted by start", () => {
    const out = filterUpcomingShifts([row("b", A, "2026-10-28"), row("c", A, "2026-10-26", "cancelled"), row("l", A, "2026-10-25", "on_leave")], A, now);
    expect(out.map((s) => s.id)).toEqual(["l", "b"]);
  });
});

describe("owner shift editing", () => {
  test("future scheduled shift is editable", () => {
    expect(shiftEditEligibility({ status: "scheduled", starts_at: "2026-10-24T03:00:00Z" }, now)).toEqual({ ok: true });
  });
  test("started shift cannot be edited", () => {
    expect(shiftEditEligibility({ status: "scheduled", starts_at: "2026-10-23T15:00:00Z" }, now).ok).toBe(false);
  });
  for (const status of ["in_progress", "completed", "missed", "cancelled", "on_leave"]) {
    test(`${status} shift cannot be edited`, () => {
      expect(shiftEditEligibility({ status, starts_at: "2026-10-30T03:00:00Z" }, now).ok).toBe(false);
    });
  }
  const win = { startAt: "2026-10-24T03:00:00Z", endAt: "2026-10-24T11:00:00Z" };
  test("the shift being edited never overlaps itself", () => {
    expect(findOverlapExcluding([{ id: "self", ...win, status: "scheduled" }], "self", win)).toBeNull();
  });
  test("another live shift that overlaps is reported", () => {
    const other = { id: "o", startAt: "2026-10-24T10:00:00Z", endAt: "2026-10-24T14:00:00Z", status: "scheduled" };
    expect(findOverlapExcluding([other], "self", win)?.id).toBe("o");
  });
  test("back-to-back, cancelled and on-leave shifts do not block", () => {
    const rows = [
      { id: "adj", startAt: "2026-10-24T11:00:00Z", endAt: "2026-10-24T15:00:00Z", status: "scheduled" },
      { id: "c", ...win, status: "cancelled" },
      { id: "l", ...win, status: "on_leave" },
    ];
    expect(findOverlapExcluding(rows, "self", win)).toBeNull();
  });
  test("database exclusion constraint error is recognised", () => {
    expect(isShiftOverlapConstraintError({ code: "23P01", message: "x" })).toBe(true);
    expect(isShiftOverlapConstraintError({ message: 'conflicting key value violates exclusion constraint "attendance_shifts_no_overlap"' })).toBe(true);
    expect(isShiftOverlapConstraintError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isShiftOverlapConstraintError(null)).toBe(false);
  });
});
