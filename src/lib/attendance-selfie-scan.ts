/**
 * Orphan selfie scanner — STRICT DRY-RUN / REPORT ONLY.
 *
 * Classifies clock-in selfie files in the private evidence bucket. It never
 * deletes anything and exposes no deletion API. A file is only reported as an
 * orphan candidate when it is a well-formed selfie path, older than the
 * minimum age, and referenced by no attendance session.
 */
export const ORPHAN_SELFIE_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const ORPHAN_SCAN_DRY_RUN = true as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SELFIE_RE = new RegExp(`^(${UUID})/(\\d{4}-\\d{2}-\\d{2})/(\\d{13})-(${UUID})\\.jpg$`);

export interface StoredFile { path: string; createdAt?: string | null }
export interface OrphanScanResult {
  dryRun: true;
  scanned: number;
  referenced: number;
  tooRecent: number;
  ignored: number;
  candidates: { path: string; ageHours: number }[];
}

export function classifyOrphanSelfies(files: StoredFile[], referencedPaths: Iterable<string>, now: number, minAgeMs = ORPHAN_SELFIE_MIN_AGE_MS): OrphanScanResult {
  const minAge = Math.max(minAgeMs, ORPHAN_SELFIE_MIN_AGE_MS); // never below 24 h
  const refs = new Set(referencedPaths);
  const out: OrphanScanResult = { dryRun: true, scanned: files.length, referenced: 0, tooRecent: 0, ignored: 0, candidates: [] };
  for (const f of files) {
    const m = SELFIE_RE.exec(f.path);
    if (!m) { out.ignored++; continue; } // task photos, unknown files: never touched
    if (refs.has(f.path)) { out.referenced++; continue; }
    const fromName = Number(m[3]);
    const fromMeta = f.createdAt ? Date.parse(f.createdAt) : NaN;
    // Use the most recent known time so a tampered name can't make a file look older.
    const born = Number.isFinite(fromMeta) ? Math.max(fromName, fromMeta) : fromName;
    const age = now - born;
    if (!(age >= minAge)) { out.tooRecent++; continue; }
    out.candidates.push({ path: f.path, ageHours: Math.floor(age / 3_600_000) });
  }
  return out;
}
