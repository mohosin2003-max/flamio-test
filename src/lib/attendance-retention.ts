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

/* ---------------- Calendar-month boundaries (Asia/Dhaka, UTC+6, no DST) ---------------- */

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

export interface MonthWindow { label: string; startUtc: string; endUtc: string }

/** The previous full Asia/Dhaka calendar month relative to `now`: [start, end). */
export function previousDhakaMonth(now: Date): MonthWindow {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth(); // current Dhaka month (0-based)
  const start = Date.UTC(y, m - 1, 1) - DHAKA_OFFSET_MS;
  const end = Date.UTC(y, m, 1) - DHAKA_OFFSET_MS;
  const s = new Date(start + DHAKA_OFFSET_MS);
  return {
    label: `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, "0")}`,
    startUtc: new Date(start).toISOString(),
    endUtc: new Date(end).toISOString(),
  };
}

export interface MonthlyRow { id: string; clockOutAt: string | null; status: string; verificationStatus: string; selfiePath: string | null }

export type ProtectReason = "open" | "auto_closed" | "disputed" | "pending_request";
export type SkipReason = "outside_month";

export interface DryRunPreview {
  window: MonthWindow;
  eligible: { id: string; hasSelfie: boolean }[];
  protected: { id: string; reason: ProtectReason }[];
  skipped: { id: string; reason: SkipReason }[];
  failed: { id: string; reason: string }[];
}

/**
 * Pure dry-run classification. Never deletes anything. Protection wins over
 * everything: open/running, auto-closed, disputed and pending-request sessions
 * are never eligible. Rows with unreadable data are reported as failed.
 */
export function classifyMonthlyRetention(rows: MonthlyRow[], pendingSessionIds: Iterable<string>, window: MonthWindow): DryRunPreview {
  const pending = new Set(pendingSessionIds);
  const start = Date.parse(window.startUtc);
  const end = Date.parse(window.endUtc);
  const out: DryRunPreview = { window, eligible: [], protected: [], skipped: [], failed: [] };
  for (const r of rows) {
    if (r.clockOutAt === null || r.status === "open") { out.protected.push({ id: r.id, reason: "open" }); continue; }
    if (r.status === "auto_closed") { out.protected.push({ id: r.id, reason: "auto_closed" }); continue; }
    if (r.verificationStatus === "disputed") { out.protected.push({ id: r.id, reason: "disputed" }); continue; }
    if (pending.has(r.id)) { out.protected.push({ id: r.id, reason: "pending_request" }); continue; }
    const t = Date.parse(r.clockOutAt);
    if (Number.isNaN(t)) { out.failed.push({ id: r.id, reason: "invalid_clock_out" }); continue; }
    if (t < start || t >= end) { out.skipped.push({ id: r.id, reason: "outside_month" }); continue; }
    out.eligible.push({ id: r.id, hasSelfie: !!r.selfiePath });
  }
  return out;
}
