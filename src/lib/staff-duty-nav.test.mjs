import { describe, expect, test } from "bun:test";
import { canSeeStaffDuty } from "./permissions.ts";

describe("My duty visibility", () => {
  test("staff with attendance access sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, grants: { attendance: "view" } })).toBe(true);
  });
  test("owner never sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, isOwner: true, isManager: true })).toBe(false);
  });
  test("manager never sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, isManager: true })).toBe(false);
  });
  test("staff without attendance access does not see it", () => {
    expect(canSeeStaffDuty({ isStaff: true, grants: { customers: "view" } })).toBe(false);
  });
  test("signed-out / customer does not see it", () => {
    expect(canSeeStaffDuty(null)).toBe(false);
    expect(canSeeStaffDuty({ grants: { attendance: "view" } })).toBe(false);
  });
});
