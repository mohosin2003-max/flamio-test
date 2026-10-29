/**
 * Pure, retry-safe evidence photo sweep (no Deno/Supabase imports so it can be
 * unit-tested with mocks).
 *
 * Safety order per batch:
 *   1. Remove the batch from Storage.
 *   2. Only if Storage confirmed success, clear DB references for the expired
 *      evidence paths in that batch. Orphan task photos have no references.
 * A failed Storage batch keeps its references, so the next run lists and
 * retries it. A failed clear leaves references on files that are already gone;
 * the next run removes them again (Storage ignores missing objects) and
 * retries the clear — idempotent.
 */
export interface SweepPorts {
  /** Remove objects. Missing objects must not be an error. */
  removeFiles(paths: string[]): Promise<{ error: string | null }>;
  clearExpiredRefs(paths: string[]): Promise<{ error: string | null }>;
}

export interface SweepResult {
  candidates: number;
  removed: number;
  failed: number;
  refsCleared: number;
  refClearFailed: number;
  storageFailedPaths: string[];
  refClearFailedPaths: string[];
  partial: boolean;
}

export const SWEEP_BATCH_SIZE = 100;

const msg = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

export async function runEvidenceSweep(
  orphanPaths: string[],
  expiredPaths: string[],
  ports: SweepPorts,
  batchSize = SWEEP_BATCH_SIZE,
): Promise<SweepResult> {
  const expired = new Set(expiredPaths);
  const paths = [...new Set([...orphanPaths, ...expiredPaths])];
  const r: SweepResult = { candidates: paths.length, removed: 0, failed: 0, refsCleared: 0, refClearFailed: 0, storageFailedPaths: [], refClearFailedPaths: [], partial: false };

  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    let storageError: string | null;
    try { storageError = (await ports.removeFiles(batch)).error; }
    catch (e) { storageError = msg(e, "storage error"); }
    if (storageError) {
      r.failed += batch.length;
      r.storageFailedPaths.push(...batch);
      continue; // references preserved for retry
    }
    r.removed += batch.length;

    const toClear = batch.filter((p) => expired.has(p));
    if (!toClear.length) continue;
    let clearError: string | null;
    try { clearError = (await ports.clearExpiredRefs(toClear)).error; }
    catch (e) { clearError = msg(e, "db error"); }
    if (clearError) { r.refClearFailed += toClear.length; r.refClearFailedPaths.push(...toClear); }
    else r.refsCleared += toClear.length;
  }
  r.partial = r.failed > 0 || r.refClearFailed > 0;
  return r;
}
