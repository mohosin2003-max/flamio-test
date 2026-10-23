/**
 * Clock-out geofence decision (pure, no I/O). The server is authoritative.
 * Reuses evaluateGeofence (coordinate validity, staleness) with the same
 * 50 m accuracy cap and strict radius test used at clock-in.
 */
import { distanceMeters, evaluateGeofence } from "@/lib/attendance-logic";

export const CLOCK_OUT_MAX_ACCURACY_METERS = 50;
export const CLOCK_OUT_MAX_AGE_MS = 2 * 60 * 1000;
export const EXCEPTION_REQUIRED_PREFIX = "LOCATION_EXCEPTION_REQUIRED:";
export const EXCEPTION_REASON_MIN = 10;
export const EXCEPTION_REASON_MAX = 300;

export type ClockOutDiscrepancy =
  | "no_location" | "invalid_location" | "stale_location" | "inaccurate_location"
  | "outside_geofence" | "station_unverifiable";

export type ClockOutStation = { latitude: number | null; longitude: number | null; radius: number; isActive: boolean } | null;
export type ClockOutPoint = { latitude?: number | undefined; longitude?: number | undefined; accuracyMeters?: number | undefined; capturedAt?: number | undefined };

export type ClockOutDecision =
  | { ok: true; mode: "normal" | "verified_location"; distance?: number | undefined }
  | { ok: true; mode: "exception"; discrepancy: ClockOutDiscrepancy; reason: string; distance?: number | undefined }
  | { ok: false; needsReason: boolean; discrepancy?: ClockOutDiscrepancy; error: string };

const MESSAGES: Record<ClockOutDiscrepancy, string> = {
  no_location: "Your location could not be read.",
  invalid_location: "Your location reading is invalid.",
  stale_location: "Your location reading is too old.",
  inaccurate_location: "GPS accuracy is too low.",
  outside_geofence: "You are outside your station's attendance area.",
  station_unverifiable: "Your shift's station location cannot be verified.",
};

export function validateExceptionReason(reason: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  if (typeof reason !== "string") return { ok: false, error: "A reason is required." };
  const trimmed = reason.trim().replace(/\s+/g, " ");
  if (trimmed.length < EXCEPTION_REASON_MIN) return { ok: false, error: `Reason must be at least ${EXCEPTION_REASON_MIN} characters.` };
  if (trimmed.length > EXCEPTION_REASON_MAX) return { ok: false, error: `Reason must be at most ${EXCEPTION_REASON_MAX} characters.` };
  return { ok: true, reason: trimmed };
}

export function decideClockOutLocation(input: {
  geofenceEnabled: boolean;
  sessionUserId: string;
  callerId: string;
  station: ClockOutStation;
  point: ClockOutPoint;
  exceptionReason?: string | null;
  now: number;
}): ClockOutDecision {
  if (input.sessionUserId !== input.callerId) return { ok: false, needsReason: false, error: "This attendance session does not belong to you." };
  if (!input.geofenceEnabled) return { ok: true, mode: "normal" };

  let discrepancy: ClockOutDiscrepancy | null = null;
  let distance: number | undefined;
  const st = input.station;
  const p = input.point;
  if (!st || !st.isActive || st.latitude == null || st.longitude == null || !Number.isFinite(st.radius) || st.radius <= 0) {
    discrepancy = "station_unverifiable";
  } else if (p.latitude === undefined || p.longitude === undefined || p.accuracyMeters === undefined || p.capturedAt === undefined) {
    discrepancy = "no_location";
  } else {
    const r = evaluateGeofence({
      point: { lat: p.latitude, lng: p.longitude, accuracy: p.accuracyMeters, capturedAt: p.capturedAt },
      station: { lat: st.latitude, lng: st.longitude, radius: st.radius },
      now: input.now, maxAccuracyMeters: CLOCK_OUT_MAX_ACCURACY_METERS, maxAgeMs: CLOCK_OUT_MAX_AGE_MS,
    });
    if (!r.ok && (r.reason === "invalid" || r.reason === "future")) discrepancy = "invalid_location";
    else if (!r.ok && r.reason === "stale") discrepancy = "stale_location";
    else if (!r.ok && r.reason === "inaccurate") discrepancy = "inaccurate_location";
    else {
      // Strict radius test, identical to clock-in (no accuracy tolerance).
      distance = distanceMeters({ lat: p.latitude, lng: p.longitude }, { lat: st.latitude, lng: st.longitude });
      if (!Number.isFinite(distance) || distance > st.radius) discrepancy = "outside_geofence";
    }
  }
  if (!discrepancy) return { ok: true, mode: "verified_location", distance };

  if (input.exceptionReason == null || input.exceptionReason === "") {
    return { ok: false, needsReason: true, discrepancy, error: `${EXCEPTION_REQUIRED_PREFIX}${discrepancy}:${MESSAGES[discrepancy]} Give a reason to clock out for Owner review.` };
  }
  const reason = validateExceptionReason(input.exceptionReason);
  if (!reason.ok) return { ok: false, needsReason: true, discrepancy, error: `${EXCEPTION_REQUIRED_PREFIX}${discrepancy}:${reason.error}` };
  return { ok: true, mode: "exception", discrepancy, reason: reason.reason, distance };
}

/** Keep existing flags; append each new flag once. */
export function appendFlags(existing: unknown, add: string[]): string[] {
  const base = Array.isArray(existing) ? existing.filter((f): f is string => typeof f === "string") : [];
  const out = [...base];
  for (const f of add) if (!out.includes(f)) out.push(f);
  return out;
}

export function parseExceptionRequired(message: string): { discrepancy: string; message: string } | null {
  const i = message.indexOf(EXCEPTION_REQUIRED_PREFIX);
  if (i < 0) return null;
  const rest = message.slice(i + EXCEPTION_REQUIRED_PREFIX.length);
  const colon = rest.indexOf(":");
  return colon < 0 ? { discrepancy: rest, message: rest } : { discrepancy: rest.slice(0, colon), message: rest.slice(colon + 1) };
}
