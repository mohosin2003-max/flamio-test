import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runEvidenceSweep } from "./sweep.ts";

Deno.test("deduplicates candidates and clears references only after storage success", async () => {
  const calls: string[] = [];
  const result = await runEvidenceSweep(
    ["tasks/u1/photo.jpg", "tasks/u1/photo.jpg"],
    ["attendance/u1/evidence.jpg", "tasks/u1/photo.jpg"],
    {
      async removeFiles(paths) { calls.push("remove:" + paths.join(",")); return { error: null }; },
      async clearExpiredRefs(paths) { calls.push("clear:" + paths.join(",")); return { error: null }; },
    },
  );
  assertEquals(result.candidates, 2);
  assertEquals(result.removed, 2);
  assertEquals(result.refsCleared, 2);
  assertEquals(result.partial, false);
  assertEquals(calls.length, 2);
  assertEquals(calls[0].startsWith("remove:"), true);
  assertEquals(calls[1].startsWith("clear:"), true);
});

Deno.test("preserves references when storage removal fails", async () => {
  let clearCalls = 0;
  const result = await runEvidenceSweep(
    [],
    ["attendance/u1/evidence.jpg"],
    {
      async removeFiles() { return { error: "mock storage failure" }; },
      async clearExpiredRefs() { clearCalls++; return { error: null }; },
    },
  );
  assertEquals(result.failed, 1);
  assertEquals(result.refsCleared, 0);
  assertEquals(result.partial, true);
  assertEquals(clearCalls, 0);
});

Deno.test("reports partial failure if reference clearing fails after storage succeeds", async () => {
  const result = await runEvidenceSweep(
    [],
    ["attendance/u1/evidence.jpg"],
    {
      async removeFiles() { return { error: null }; },
      async clearExpiredRefs() { return { error: "mock database failure" }; },
    },
  );
  assertEquals(result.removed, 1);
  assertEquals(result.refClearFailed, 1);
  assertEquals(result.partial, true);
});

Deno.test("continues after thrown storage error and retries can safely rescan", async () => {
  let clearCalls = 0;
  const result = await runEvidenceSweep(
    ["tasks/u1/photo.jpg"],
    ["attendance/u1/evidence.jpg"],
    {
      async removeFiles(paths) {
        if (paths.includes("tasks/u1/photo.jpg")) throw new Error("mock throw");
        return { error: null };
      },
      async clearExpiredRefs() { clearCalls++; return { error: null }; },
    },
    1,
  );
  assertEquals(result.failed, 1);
  assertEquals(result.removed, 1);
  assertEquals(result.partial, true);
  assertEquals(clearCalls, 1);
});
