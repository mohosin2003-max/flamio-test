import { describe, it, expect } from "bun:test";
import { assertStatusUpdateApplied, STALE_ORDER_MESSAGE } from "./order-status-cas.ts";

/** Mocked CAS store: update applies only if current status equals expected. */
function store(status) {
  const row = { id: "o1", status };
  return {
    row,
    update(expected, next) {
      if (row.status !== expected) return [];
      row.status = next;
      return [{ ...row }];
    },
  };
}

describe("order status compare-and-set (mocked concurrency)", () => {
  it("cancellation first: kitchen 'preparing' gets a conflict, order stays cancelled", () => {
    const s = store("confirmed");
    assertStatusUpdateApplied(s.update("confirmed", "cancelled"), "cancelled");
    const rows = s.update("confirmed", "preparing");
    expect(() => assertStatusUpdateApplied(rows, "preparing")).toThrow(STALE_ORDER_MESSAGE);
    expect(s.row.status).toBe("cancelled");
  });
  it("kitchen first: cancellation of the read status gets a conflict, order stays preparing", () => {
    const s = store("confirmed");
    assertStatusUpdateApplied(s.update("confirmed", "preparing"), "preparing");
    expect(() =>
      assertStatusUpdateApplied(s.update("confirmed", "cancelled"), "cancelled"),
    ).toThrow();
    expect(s.row.status).toBe("preparing");
  });
  it("null rows is a conflict, single matching row succeeds", () => {
    expect(() => assertStatusUpdateApplied(null, "ready")).toThrow();
    expect(() => assertStatusUpdateApplied([{ id: "o1", status: "ready" }], "ready")).not.toThrow();
  });
});
