import { describe, expect, test } from "bun:test";
import { canEditTask, incompleteTasks, normalizeChecklistItems, selfieCountsByRow } from "./attendance-rules.ts";

describe("checklist customization", () => {
  test("trims, drops blanks and duplicates", () => {
    expect(normalizeChecklistItems(["  Lights on ", "", "lights ON", "Gas  off"])).toEqual(["Lights on", "Gas off"]);
  });
  test("rejects empty list", () => { expect(() => normalizeChecklistItems(["  "])).toThrow(); });
  test("rejects more than 30 items", () => { expect(() => normalizeChecklistItems(Array.from({ length: 31 }, (_, i) => `Item ${i}`))).toThrow(); });
  test("rejects labels over 160 chars", () => { expect(() => normalizeChecklistItems(["x".repeat(161)])).toThrow(); });
});

describe("task edit/disable", () => {
  test("open tasks are editable", () => { for (const s of ["pending", "in_progress", "rejected"]) expect(canEditTask(s)).toBe(true); });
  test("closed tasks keep history (not editable)", () => { for (const s of ["completed", "verified", "cancelled"]) expect(canEditTask(s)).toBe(false); });
});

describe("incomplete-task status", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  const base = { totalItems: 2, doneItems: 1, dueAt: null };
  test("flags overdue and due-today, ignores closed and future", () => {
    const r = incompleteTasks([
      { ...base, id: "a", status: "pending", dueDate: "2026-10-19" },
      { ...base, id: "b", status: "in_progress", dueDate: "2026-10-20" },
      { ...base, id: "c", status: "completed", dueDate: "2026-10-19" },
      { ...base, id: "d", status: "pending", dueDate: "2026-10-21" },
      { ...base, id: "e", status: "cancelled", dueDate: "2026-10-01" },
      { ...base, id: "f", status: "pending", dueDate: "2026-10-20", dueAt: "2026-10-20T11:00:00Z" },
    ], now, "2026-10-20");
    expect(r.map((x) => [x.id, x.reason])).toEqual([["a", "overdue"], ["b", "due_today"], ["f", "overdue"]]);
  });
});

describe("selfie status per report row", () => {
  test("counts captured selfies, zero means None", () => {
    expect(selfieCountsByRow([
      { userId: "u1", dutyDate: "2026-10-01", hasSelfie: true },
      { userId: "u1", dutyDate: "2026-10-01", hasSelfie: false },
      { userId: "u2", dutyDate: "2026-10-01", hasSelfie: false },
    ], "daily")).toEqual({ "2026-10-01|u1": 1, "2026-10-01|u2": 0 });
  });
});
