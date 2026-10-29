import { describe, expect, test } from "bun:test";
import { runEvidenceSweep } from "../../supabase/functions/attendance-task-photo-orphan-sweep/sweep.ts";

// In-memory mock: files in Storage, references in DB. Nothing real is touched.
function world({ storageFails = () => false, clearFails = () => false, throwStorage = false } = {}) {
  const files = new Set(["u/sel1.jpg", "u/sel2.jpg", "u/tasks/t/1-o.jpg"]);
  const refs = new Set(["u/sel1.jpg", "u/sel2.jpg"]);
  const log = [];
  return {
    files, refs, log,
    ports: {
      async removeFiles(p) {
        log.push(["remove", [...p]]);
        if (throwStorage) throw new Error("boom");
        if (storageFails(p)) return { error: "storage down" };
        p.forEach((x) => files.delete(x)); // absent files are not an error
        return { error: null };
      },
      async clearExpiredRefs(p) {
        log.push(["clear", [...p]]);
        if (clearFails(p)) return { error: "db down" };
        p.forEach((x) => refs.delete(x));
        return { error: null };
      },
    },
  };
}
const ORPH = ["u/tasks/t/1-o.jpg"], EXP = ["u/sel1.jpg", "u/sel2.jpg"];

describe("evidence photo sweep safety", () => {
  test("success: storage removed before references cleared", async () => {
    const w = world();
    const r = await runEvidenceSweep(ORPH, EXP, w.ports);
    expect(r).toMatchObject({ candidates: 3, removed: 3, failed: 0, refsCleared: 2, partial: false });
    expect(w.log.map((l) => l[0])).toEqual(["remove", "clear"]);
    expect(w.files.size).toBe(0);
    expect(w.refs.size).toBe(0);
  });

  test("storage failure: no reference is cleared", async () => {
    const w = world({ storageFails: () => true });
    const r = await runEvidenceSweep(ORPH, EXP, w.ports);
    expect(r).toMatchObject({ removed: 0, failed: 3, refsCleared: 0, partial: true });
    expect(w.log.some((l) => l[0] === "clear")).toBe(false);
    expect([...w.refs].sort()).toEqual(EXP);
  });

  test("storage throwing is treated as failure, references kept", async () => {
    const w = world({ throwStorage: true });
    const r = await runEvidenceSweep(ORPH, EXP, w.ports);
    expect(r.failed).toBe(3);
    expect(w.refs.size).toBe(2);
  });

  test("partial batch failure: only successful batch is cleared", async () => {
    const w = world({ storageFails: (p) => p.includes("u/sel2.jpg") });
    const r = await runEvidenceSweep([], EXP, w.ports, 1);
    expect(r).toMatchObject({ removed: 1, failed: 1, refsCleared: 1, partial: true });
    expect(r.storageFailedPaths).toEqual(["u/sel2.jpg"]);
    expect([...w.refs]).toEqual(["u/sel2.jpg"]);
    expect(w.files.has("u/sel2.jpg")).toBe(true);
  });

  test("reference clear failure is reported, then retry is idempotent", async () => {
    let fail = true;
    const w = world({ clearFails: () => fail });
    const first = await runEvidenceSweep([], EXP, w.ports);
    expect(first).toMatchObject({ removed: 2, refsCleared: 0, refClearFailed: 2, partial: true });
    expect(w.files.has("u/sel1.jpg")).toBe(false);
    expect(w.refs.size).toBe(2); // still listed next run
    fail = false;
    const retry = await runEvidenceSweep([], [...w.refs], w.ports); // files already absent
    expect(retry).toMatchObject({ removed: 2, failed: 0, refsCleared: 2, partial: false });
    expect(w.refs.size).toBe(0);
    const again = await runEvidenceSweep([], [], w.ports);
    expect(again).toMatchObject({ candidates: 0, removed: 0, partial: false });
  });

  test("orphan task photos never trigger a reference clear", async () => {
    const w = world();
    const r = await runEvidenceSweep(ORPH, [], w.ports);
    expect(r.removed).toBe(1);
    expect(w.log.some((l) => l[0] === "clear")).toBe(false);
  });

  test("only expired paths in the batch are cleared; duplicates deduped", async () => {
    const w = world();
    await runEvidenceSweep([...ORPH, "u/sel1.jpg"], ["u/sel1.jpg"], w.ports);
    const clears = w.log.filter((l) => l[0] === "clear");
    expect(clears).toEqual([["clear", ["u/sel1.jpg"]]]);
    expect(w.log[0][1]).toEqual([...ORPH, "u/sel1.jpg"]);
  });

  test("batches are at most 100 paths", async () => {
    const paths = Array.from({ length: 250 }, (_, i) => `u/p${i}.jpg`);
    const w = world();
    const r = await runEvidenceSweep([], paths, w.ports);
    const sizes = w.log.filter((l) => l[0] === "remove").map((l) => l[1].length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(r).toMatchObject({ removed: 250, refsCleared: 250 });
  });

  test("empty input makes no calls (dry-run path is handled before sweep)", async () => {
    const w = world();
    await runEvidenceSweep([], [], w.ports);
    expect(w.log).toEqual([]);
  });
});
