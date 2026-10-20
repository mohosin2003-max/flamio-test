/**
 * Pure, retry-safe retention purge orchestration for attendance sessions and
 * their clock-in selfie files. Storage and database access are injected so the
 * order of operations can be tested without touching real data.
 *
 * Order per batch: remove selfie files first, then breaks, then sessions.
 * A session is only deleted when its selfie file removal succeeded (or it has
 * no selfie). Storage removal is idempotent, so already-missing files are fine
 * and a re-run simply retries whatever is left.
 */
export interface PurgeCandidate { id: string; selfiePath: string | null }

export interface PurgePorts {
  /** Remove files. Missing files must not be treated as an error. */
  removeFiles(paths: string[]): Promise<{ error: string | null }>;
  deleteBreaks(sessionIds: string[]): Promise<{ error: string | null }>;
  /** Returns the ids that were actually deleted. */
  deleteSessions(sessionIds: string[]): Promise<{ deletedIds: string[]; error: string | null }>;
}

export interface PurgeResult {
  deletedSessions: number;
  removedSelfieFiles: number;
  storageFailedSessions: string[];
  databaseFailedSessions: string[];
  partial: boolean;
}

export const RETENTION_BATCH_SIZE = 100;

export async function purgeRetention(candidates: PurgeCandidate[], ports: PurgePorts, batchSize = RETENTION_BATCH_SIZE): Promise<PurgeResult> {
  const result: PurgeResult = { deletedSessions: 0, removedSelfieFiles: 0, storageFailedSessions: [], databaseFailedSessions: [], partial: false };
  const unique = [...new Map(candidates.map((c) => [c.id, c])).values()];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const withFiles = batch.filter((c) => c.selfiePath);
    let cleared = batch.filter((c) => !c.selfiePath);
    if (withFiles.length) {
      let storageError: string | null;
      try { storageError = (await ports.removeFiles(withFiles.map((c) => c.selfiePath as string))).error; }
      catch (e) { storageError = e instanceof Error ? e.message : "storage error"; }
      if (storageError) result.storageFailedSessions.push(...withFiles.map((c) => c.id));
      else { result.removedSelfieFiles += withFiles.length; cleared = cleared.concat(withFiles); }
    }
    if (!cleared.length) continue;
    const ids = cleared.map((c) => c.id);
    let breaksError: string | null;
    try { breaksError = (await ports.deleteBreaks(ids)).error; } catch (e) { breaksError = e instanceof Error ? e.message : "db error"; }
    if (breaksError) { result.databaseFailedSessions.push(...ids); continue; }
    let deleted: string[] = [];
    try {
      const r = await ports.deleteSessions(ids);
      deleted = r.error ? [] : r.deletedIds;
    } catch { deleted = []; }
    const deletedSet = new Set(deleted);
    result.deletedSessions += deleted.length;
    result.databaseFailedSessions.push(...ids.filter((id) => !deletedSet.has(id)));
  }
  result.partial = result.storageFailedSessions.length > 0 || result.databaseFailedSessions.length > 0;
  return result;
}
