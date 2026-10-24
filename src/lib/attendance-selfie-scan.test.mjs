import { describe, expect, test } from "bun:test";
import { classifyOrphanSelfies, ORPHAN_SCAN_DRY_RUN } from "./attendance-selfie-scan.ts";
import * as scan from "./attendance-selfie-scan.ts";

const U = "11111111-1111-4111-8111-111111111111";
const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-24T12:00:00Z");
const p = (ms, n) => `${U}/${new Date(ms + 6 * 3600e3).toISOString().slice(0, 10)}/${ms}-${id(n)}.jpg`;
const old = now - 48 * 3600e3, fresh = now - 2 * 3600e3;

describe("orphan selfie dry-run scan", () => {
  test("is dry-run only and exposes no delete function", () => {
    expect(ORPHAN_SCAN_DRY_RUN).toBe(true);
    expect(Object.keys(scan).some((k) => /delete|remove|purge/i.test(k))).toBe(false);
    expect(classifyOrphanSelfies([], [], now).dryRun).toBe(true);
  });
  test("old unreferenced selfie is a candidate", () => {
    const r = classifyOrphanSelfies([{ path: p(old, 1) }], [], now);
    expect(r.candidates.map((c) => c.path)).toEqual([p(old, 1)]);
    expect(r.candidates[0].ageHours).toBe(48);
  });
  test("referenced selfie is never a candidate", () => {
    const r = classifyOrphanSelfies([{ path: p(old, 1) }], [p(old, 1)], now);
    expect(r.candidates.length).toBe(0); expect(r.referenced).toBe(1);
  });
  test("files younger than 24 h are too recent", () => {
    expect(classifyOrphanSelfies([{ path: p(fresh, 2) }], [], now).tooRecent).toBe(1);
  });
  test("minimum age cannot be lowered below 24 h", () => {
    expect(classifyOrphanSelfies([{ path: p(fresh, 2) }], [], now, 1000).candidates.length).toBe(0);
  });
  test("task photos and malformed paths are ignored", () => {
    const r = classifyOrphanSelfies([{ path: `${U}/tasks/${id(3)}/${old}-${id(4)}.jpg` }, { path: "../x.jpg" }], [], now);
    expect(r.ignored).toBe(2); expect(r.candidates.length).toBe(0);
  });
  test("recent upload metadata overrides an old-looking file name", () => {
    expect(classifyOrphanSelfies([{ path: p(old, 5), createdAt: new Date(fresh).toISOString() }], [], now).tooRecent).toBe(1);
  });
});
