import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createEvidenceSweepHandler } from "./handler.ts";

Deno.test("rejects requests without cleanup secret before scanning", async () => {
  let listCalls = 0;
  const handler = createEvidenceSweepHandler({
    async authorize() { return false; },
    async listCandidates() { listCalls++; return { orphanPaths: [], expiredPaths: [] }; },
    async sweep() { throw new Error("must not sweep"); },
  });
  const response = await handler(new Request("https://test.local", {
    method: "POST", headers: { "content-type": "application/json", "x-attendance-cleanup-secret": "bad" }, body: JSON.stringify({ dryRun: true }),
  }));
  assertEquals(response.status, 401);
  assertEquals(listCalls, 0);
});

Deno.test("dryRun true lists candidates but never invokes sweep", async () => {
  let sweepCalls = 0;
  const handler = createEvidenceSweepHandler({
    async authorize() { return true; },
    async listCandidates() { return { orphanPaths: ["tasks/mock.jpg"], expiredPaths: ["attendance/mock.jpg"] }; },
    async sweep() { sweepCalls++; throw new Error("must not sweep in dry run"); },
  });
  const response = await handler(new Request("https://test.local", {
    method: "POST", headers: { "content-type": "application/json", "x-attendance-cleanup-secret": "mock" }, body: JSON.stringify({ dryRun: true }),
  }));
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.dryRun, true);
  assertEquals(body.candidates, 2);
  assertEquals(body.removed, 0);
  assertEquals(sweepCalls, 0);
});

Deno.test("requires dryRun to be explicitly set", async () => {
  const handler = createEvidenceSweepHandler({
    async authorize() { return true; },
    async listCandidates() { throw new Error("must not scan"); },
    async sweep() { throw new Error("must not sweep"); },
  });
  const response = await handler(new Request("https://test.local", {
    method: "POST", headers: { "content-type": "application/json", "x-attendance-cleanup-secret": "mock" }, body: JSON.stringify({}),
  }));
  assertEquals(response.status, 400);
});

Deno.test("dryRun false reaches only mocked sweep dependency", async () => {
  let sweepCalls = 0;
  const handler = createEvidenceSweepHandler({
    async authorize() { return true; },
    async listCandidates() { return { orphanPaths: ["tasks/mock.jpg"], expiredPaths: [] }; },
    async sweep() { sweepCalls++; return { candidates: 1, removed: 1, failed: 0, refsCleared: 0, refClearFailed: 0, partial: false }; },
  });
  const response = await handler(new Request("https://test.local", {
    method: "POST", headers: { "content-type": "application/json", "x-attendance-cleanup-secret": "mock" }, body: JSON.stringify({ dryRun: false }),
  }));
  assertEquals(response.status, 200);
  assertEquals(sweepCalls, 1);
});
