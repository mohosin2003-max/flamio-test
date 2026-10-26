import { describe, expect, test } from "bun:test";
import { reviewSessionError } from "./attendance-review.ts";

const owner = { userId: "o", isOwner: true, isManager: true };
const manager = { userId: "m", isOwner: false, isManager: true };
const staff = { userId: "s", isOwner: false, isManager: false };
const closed = (userId) => ({ userId, clockOutAt: "2026-10-26T10:00:00Z" });

describe("session review rules", () => {
  test("manager cannot verify own session", () => expect(reviewSessionError(manager, closed("m"), "verified")).toMatch(/own/));
  test("manager cannot dispute own session", () => expect(reviewSessionError(manager, closed("m"), "disputed", "late arrival")).toMatch(/own/));
  test("manager cannot unverify own session", () => expect(reviewSessionError(manager, closed("m"), "unverified")).toMatch(/own/));
  test("manager can verify another staff session", () => expect(reviewSessionError(manager, closed("s"), "verified")).toBeNull());
  test("owner may review own session", () => expect(reviewSessionError(owner, closed("o"), "verified")).toBeNull());
  test("staff cannot review", () => expect(reviewSessionError(staff, closed("x"), "verified")).toMatch(/Only/));
  test("open session cannot be verified", () => expect(reviewSessionError(owner, { userId: "s", clockOutAt: null }, "verified")).toMatch(/open/));
  test("dispute needs a 5+ char note", () => {
    expect(reviewSessionError(owner, closed("s"), "disputed", "no")).toMatch(/note/);
    expect(reviewSessionError(owner, closed("s"), "disputed", "wrong time")).toBeNull();
  });
});
