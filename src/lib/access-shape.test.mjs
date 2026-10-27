import { describe, expect, test } from "bun:test";
import { serializeOwnerAccess } from "./access-shape.ts";
import { canSeeOwnerAttendance, canSeeStaffDuty, workspaceNavKinds } from "./permissions.ts";

// Profiles mirror getAccessProfile in owner.server.ts.
const owner = serializeOwnerAccess({ isOwner: true, isManager: true, isStaff: false, permissions: ["staff"], grants: { staff: "manage" } }, ["owner"], 1);
const manager = serializeOwnerAccess({ isOwner: false, isManager: true, isStaff: true, permissions: ["staff"], grants: { staff: "manage" } }, ["admin"], 1);
const staff = serializeOwnerAccess({ isOwner: false, isManager: false, isStaff: true, permissions: [], grants: {} }, ["staff"], 1);
const customer = serializeOwnerAccess({ isOwner: false, isManager: false, isStaff: false, permissions: [], grants: {} }, [], 1);

describe("serialized getOwnerAccess response", () => {
  test("staff is not labelled Owner", () => {
    expect(staff.isOwner).toBe(false);
    expect(staff.isStaff).toBe(true);
    expect(staff.hasWorkspaceAccess).toBe(true);
  });
  test("staff sees My duty (5 items)", () => {
    expect(canSeeStaffDuty(staff)).toBe(true);
    expect(workspaceNavKinds(staff)).toEqual(["home", "messages", "orders", "duty", "account"]);
    expect(canSeeOwnerAttendance(staff)).toBe(false);
  });
  test("owner: 4 items, no duty", () => {
    expect(owner.isOwner).toBe(true);
    expect(canSeeStaffDuty(owner)).toBe(false);
    expect(workspaceNavKinds(owner)).toEqual(["home", "messages", "orders", "account"]);
  });
  test("manager: not owner, 4 items, no duty", () => {
    expect(manager.isOwner).toBe(false);
    expect(canSeeStaffDuty(manager)).toBe(false);
    expect(workspaceNavKinds(manager)).toEqual(["home", "messages", "orders", "account"]);
  });
  test("customer: no workspace, no duty", () => {
    expect(customer.hasWorkspaceAccess).toBe(false);
    expect(customer.isOwner).toBe(false);
    expect(canSeeStaffDuty(customer)).toBe(false);
    expect(customer.canClaim).toBe(false);
  });
  test("first user may claim only when no owner exists", () => {
    const fresh = serializeOwnerAccess({ isOwner: false, isManager: false, isStaff: false, permissions: [], grants: {} }, [], 0);
    expect(fresh.canClaim).toBe(true);
  });
});
