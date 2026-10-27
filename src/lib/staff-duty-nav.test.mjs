import { describe, expect, test } from "bun:test";
import { canSeeOwnerAttendance, canSeeStaffDuty } from "./permissions.ts";

describe("My duty visibility", () => {
  test("staff with attendance grant sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, grants: { attendance: "view" } })).toBe(true);
  });
  test("staff without attendance grant still sees own duty (matches server rule)", () => {
    expect(canSeeStaffDuty({ isStaff: true, grants: { customers: "view" } })).toBe(true);
  });
  test("owner never sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, isOwner: true, isManager: true })).toBe(false);
  });
  test("manager never sees it", () => {
    expect(canSeeStaffDuty({ isStaff: true, isManager: true })).toBe(false);
  });
  test("signed-out / customer does not see it", () => {
    expect(canSeeStaffDuty(null)).toBe(false);
    expect(canSeeStaffDuty(undefined)).toBe(false);
    expect(canSeeStaffDuty({ grants: { attendance: "view" } })).toBe(false);
  });
});

describe("Owner attendance entry", () => {
  test("owner sees it", () => expect(canSeeOwnerAttendance({ isOwner: true, isManager: true })).toBe(true));
  test("manager sees it", () => expect(canSeeOwnerAttendance({ isManager: true })).toBe(true));
  test("staff does not", () => expect(canSeeOwnerAttendance({ isOwner: false, isManager: false })).toBe(false));
  test("customer / signed-out does not", () => {
    expect(canSeeOwnerAttendance(null)).toBe(false);
    expect(canSeeOwnerAttendance({})).toBe(false);
  });
});

import { workspaceNavKinds } from "./permissions.ts";
describe("Workspace bottom nav items", () => {
  test("owner gets exactly Home, Messages, Orders, Account", () => {
    expect(workspaceNavKinds({ isOwner: true, isManager: true, isStaff: true })).toEqual(["home", "messages", "orders", "account"]);
  });
  test("manager gets exactly four items, no duty/attendance", () => {
    expect(workspaceNavKinds({ isManager: true, isStaff: true })).toEqual(["home", "messages", "orders", "account"]);
  });
  test("staff gets five items including My duty", () => {
    expect(workspaceNavKinds({ isStaff: true })).toEqual(["home", "messages", "orders", "duty", "account"]);
  });
  test("customer / signed-out gets no workspace nav", () => {
    expect(workspaceNavKinds(null)).toEqual([]);
    expect(workspaceNavKinds({})).toEqual([]);
  });
});
