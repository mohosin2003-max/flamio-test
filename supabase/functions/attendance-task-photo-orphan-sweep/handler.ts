export type EvidenceSweepResult = { candidates: number; removed: number; failed: number; refsCleared: number; refClearFailed: number; partial: boolean };
export type EvidenceSweepDependencies = {
  authorize(secret: string): Promise<boolean>;
  listCandidates(): Promise<{ orphanPaths: string[]; expiredPaths: string[] }>;
  sweep(orphanPaths: string[], expiredPaths: string[]): Promise<EvidenceSweepResult>;
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export function createEvidenceSweepHandler(deps: EvidenceSweepDependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "POST required" }, 405);
    const supplied = req.headers.get("x-attendance-cleanup-secret") ?? "";
    if (!supplied) return json({ error: "Unauthorized" }, 401);
    try { if (!(await deps.authorize(supplied))) return json({ error: "Unauthorized" }, 401); }
    catch { return json({ error: "Unauthorized" }, 401); }
    let body: { dryRun?: unknown };
    try { body = await req.json(); }
    catch { return json({ error: "Valid JSON body required; set dryRun to true or false" }, 400); }
    if (body?.dryRun !== true && body?.dryRun !== false) return json({ error: "dryRun must be explicitly true or false" }, 400);
    const dryRun = body.dryRun;
    let candidates: { orphanPaths: string[]; expiredPaths: string[] };
    try { candidates = await deps.listCandidates(); }
    catch (error) { console.error("Evidence scan failed", error); return json({ error: "Evidence scan failed" }, 500); }
    const orphanPaths = candidates.orphanPaths.filter((x) => typeof x === "string");
    const expiredPaths = candidates.expiredPaths.filter((x) => typeof x === "string");
    const paths = [...new Set([...orphanPaths, ...expiredPaths])];
    if (dryRun || paths.length === 0) return json({ dryRun, orphanCandidates: orphanPaths.length, expiredEvidenceCandidates: expiredPaths.length, candidates: paths.length, removed: 0, failed: 0 });
    let result: EvidenceSweepResult;
    try { result = await deps.sweep(orphanPaths, expiredPaths); }
    catch (error) { console.error("Evidence sweep failed", error); return json({ error: "Evidence sweep failed" }, 500); }
    return json({ dryRun: false, orphanCandidates: orphanPaths.length, expiredEvidenceCandidates: expiredPaths.length, candidates: result.candidates, removed: result.removed, failed: result.failed, refsCleared: result.refsCleared, refClearFailed: result.refClearFailed }, result.partial ? 207 : 200);
  };
}
