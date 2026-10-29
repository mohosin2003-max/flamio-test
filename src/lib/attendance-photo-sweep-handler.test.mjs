import { describe, expect, test } from "bun:test";
import { createEvidenceSweepHandler, type EvidenceSweepDependencies } from "../../supabase/functions/attendance-task-photo-orphan-sweep/handler.ts";
const secret = "test-secret";
const orphanPaths = ["u/tasks/task/photo.jpg"];
const expiredPaths = ["u/selfie/old.jpg"];
const resultOk = { candidates: 2, removed: 2, failed: 0, refsCleared: 1, refClearFailed: 0, partial: false };
function setup(overrides: Partial<EvidenceSweepDependencies> = {}) {
  const calls = { authorize: 0, list: 0, sweep: 0 };
  const deps: EvidenceSweepDependencies = {
    async authorize(value) { calls.authorize++; return value === secret; },
    async listCandidates() { calls.list++; return { orphanPaths, expiredPaths }; },
    async sweep() { calls.sweep++; return resultOk; },
    ...overrides,
  };
  const handler = createEvidenceSweepHandler(deps);
  const request = (body: string, method = "POST", withSecret = true) => new Request("https://test.invalid/sweep", {
    method, headers: { ...(withSecret ? { "x-attendance-cleanup-secret": secret } : {}), "content-type": "application/json" },
    ...(method === "GET" ? {} : { body }),
  });
  return { handler, request, calls };
}
describe("evidence sweep HTTP handler safety", () => {
  test("rejects non-POST before authorization or scan", async () => {
    const s = setup(); const r = await s.handler(s.request("", "GET"));
    expect(r.status).toBe(405); expect(s.calls).toEqual({ authorize: 0, list: 0, sweep: 0 });
  });
  test("rejects missing secret without scan or sweep", async () => {
    const s = setup(); const r = await s.handler(s.request(JSON.stringify({ dryRun: false }), "POST", false));
    expect(r.status).toBe(401); expect(s.calls).toEqual({ authorize: 0, list: 0, sweep: 0 });
  });
  test("rejects invalid secret without scan or sweep", async () => {
    const s = setup({ async authorize() { return false; } });
    const req = new Request("https://test.invalid/sweep", { method: "POST", headers: { "x-attendance-cleanup-secret": "wrong" }, body: JSON.stringify({ dryRun: false }) });
    const r = await s.handler(req); expect(r.status).toBe(401); expect(s.calls.list).toBe(0); expect(s.calls.sweep).toBe(0);
  });
  test("authorization RPC exception fails closed", async () => {
    const s = setup({ async authorize() { throw new Error("unavailable"); } });
    const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(401); expect(s.calls.list).toBe(0); expect(s.calls.sweep).toBe(0);
  });
  test("malformed JSON returns 400 without scan or sweep", async () => {
    const s = setup(); const r = await s.handler(s.request("{"));
    expect(r.status).toBe(400); expect(s.calls.list).toBe(0); expect(s.calls.sweep).toBe(0);
  });
  test("missing or non-boolean dryRun returns 400 without scan or sweep", async () => {
    for (const body of [{}, { dryRun: "false" }, { dryRun: null }, null]) {
      const s = setup(); const r = await s.handler(s.request(JSON.stringify(body)));
      expect(r.status).toBe(400); expect(s.calls.list).toBe(0); expect(s.calls.sweep).toBe(0);
    }
  });
  test("dryRun true reports candidates and never invokes sweep", async () => {
    const s = setup(); const r = await s.handler(s.request(JSON.stringify({ dryRun: true })));
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ dryRun: true, candidates: 2, removed: 0, failed: 0 });
    expect(s.calls.list).toBe(1); expect(s.calls.sweep).toBe(0);
  });
  test("dryRun false invokes sweep once and reports result counts", async () => {
    const s = setup(); const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ dryRun: false, candidates: 2, removed: 2, refsCleared: 1, failed: 0 });
    expect(s.calls.sweep).toBe(1);
  });
  test("scan failure returns 500 and never sweeps", async () => {
    const s = setup({ async listCandidates() { throw new Error("database unavailable"); } });
    const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(500); expect(s.calls.sweep).toBe(0);
  });
  test("partial sweep failure returns 207 and exposes failure counts", async () => {
    const s = setup({ async sweep() { return { ...resultOk, removed: 1, failed: 1, partial: true }; } });
    const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(207); expect(await r.json()).toMatchObject({ removed: 1, failed: 1 });
  });
  test("sweep exception returns 500", async () => {
    const s = setup({ async sweep() { throw new Error("unexpected"); } });
    const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(500);
  });
  test("empty candidates do not invoke sweep", async () => {
    const s = setup({ async listCandidates() { return { orphanPaths: [], expiredPaths: [] }; } });
    const r = await s.handler(s.request(JSON.stringify({ dryRun: false })));
    expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ candidates: 0, removed: 0, failed: 0 });
    expect(s.calls.sweep).toBe(0);
  });
});
