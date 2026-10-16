/**
 * FLAMIO ATTENDANCE MASTER — pure, isomorphic rules (no I/O).
 * Shared by server functions (authoritative) and UI (preview only).
 */

export const ATTENDANCE_TIMEZONE = "Asia/Dhaka";
/** Dhaka has no DST: fixed UTC+6. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/* ------------------------------ Geofence ------------------------------- */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface GeofenceInput {
  point: GeoPoint & { accuracy: number; capturedAt: number };
  station: GeoPoint & { radius: number };
  now: number;
  maxAccuracyMeters?: number;
  maxAgeMs?: number;
}

export type GeofenceResult =
  | { ok: true; distance: number }
  | { ok: false; reason: "invalid" | "stale" | "future" | "inaccurate" | "outside"; distance?: number };

/**
 * Server-side check of a browser-reported position. Browser GPS can be
 * spoofed; a pass means "reported inside", never proof of presence.
 */
export function evaluateGeofence({
  point,
  station,
  now,
  maxAccuracyMeters = 100,
  maxAgeMs = 2 * 60 * 1000,
}: GeofenceInput): GeofenceResult {
  const valid =
    Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 &&
    Number.isFinite(point.lng) && Math.abs(point.lng) <= 180 &&
    Number.isFinite(point.accuracy) && point.accuracy >= 0;
  if (!valid) return { ok: false, reason: "invalid" };
  if (point.capturedAt > now + 30_000) return { ok: false, reason: "future" };
  if (now - point.capturedAt > maxAgeMs) return { ok: false, reason: "stale" };
  if (point.accuracy > maxAccuracyMeters) return { ok: false, reason: "inaccurate" };
  const distance = distanceMeters(point, station);
  // Accuracy circle must overlap the fence (tolerates boundary jitter, but
  // only up to the accuracy cap above).
  if (distance - point.accuracy > station.radius) return { ok: false, reason: "outside", distance };
  return { ok: true, distance };
}

/* ------------------------------ Retention ------------------------------ */

/**
 * "One month" = same calendar day one month earlier, at 00:00 Asia/Dhaka.
 * Day-of-month is clamped (e.g. 31 Mar -> 28/29 Feb). Returns a UTC Date.
 */
export function retentionCutoff(now: Date, months = 1): Date {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() - months;
  const d = local.getUTCDate();
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const midnightLocal = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay));
  return new Date(midnightLocal - DHAKA_OFFSET_MS);
}

export interface RetentionCandidate {
  id: string;
  endedAt: string | null; // null => still active
}

/** Dry-run selection: never includes active (open) records. */
export function retentionEligible<T extends RetentionCandidate>(rows: T[], cutoff: Date): T[] {
  return rows.filter((r) => r.endedAt !== null && Date.parse(r.endedAt) < cutoff.getTime());
}

/* ------------------------------- Display -------------------------------- */

export function formatMinutes(min: number | null | undefined): string {
  const m = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

export function elapsedMinutes(fromIso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60000));
}

export function dhakaDate(now = new Date()): string {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Allowed manager transitions for tasks (mirrors SQL CHECK + RPC rules). */
export const TASK_REVIEWABLE = new Set(["completed"]);
export const TASK_CANCELLABLE = new Set(["pending", "in_progress", "rejected"]);
