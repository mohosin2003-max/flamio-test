export type AttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: number;
};

export type LocationReadFailure =
  | "unsupported"
  | "permission_denied"
  | "position_unavailable"
  | "timeout"
  | "invalid";

export class AttendanceLocationError extends Error {
  readonly code: LocationReadFailure;

  constructor(code: LocationReadFailure, message: string) {
    super(message);
    this.name = "AttendanceLocationError";
    this.code = code;
  }
}

// Attendance only needs a reliable position inside the configured fence.
// A balanced/network-assisted reading is deliberately tried first because
// Android can take much longer to produce a high-accuracy GPS fix on the
// first request. The server still enforces the final accuracy/freshness and
// geofence checks.
const FAST_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 3000,
  maximumAge: 10000,
};

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 0,
};

const WARM_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 1500,
  maximumAge: 10000,
};

function classifyPositionError(error: GeolocationPositionError): AttendanceLocationError {
  if (error.code === error.PERMISSION_DENIED) {
    return new AttendanceLocationError(
      "permission_denied",
      "Precise location permission is required. Turn on Location and Precise location for this app/browser, then try again.",
    );
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return new AttendanceLocationError(
      "position_unavailable",
      "Android could not get a GPS position. Move to an open area, keep Location on, and try again.",
    );
  }
  return new AttendanceLocationError(
    "timeout",
    "GPS took too long to respond. Keep Location on and try again.",
  );
}

function readOnce(options: PositionOptions): Promise<AttendanceLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(
      new AttendanceLocationError("unsupported", "This device/browser does not support GPS location."),
    );
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const capturedAt = Math.round(position.timestamp);
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(accuracy) ||
          accuracy < 0 ||
          !Number.isFinite(capturedAt) ||
          capturedAt <= 0
        ) {
          reject(new AttendanceLocationError("invalid", "Android returned an invalid GPS reading."));
          return;
        }
        resolve({ latitude, longitude, accuracyMeters: accuracy, capturedAt });
      },
      (error) => reject(classifyPositionError(error)),
      options,
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Reads several fresh GPS positions and returns the best one.
 *
 * We deliberately do not average coordinates: averaging independent GPS
 * readings can create a point that was never actually reported by Android.
 * The best reading is the fresh reading with the smallest uncertainty.
 */
export async function readReliableAttendanceLocation(options?: Partial<PositionOptions>): Promise<AttendanceLocation> {
  const merged: PositionOptions = { ...DEFAULT_OPTIONS, ...options };

  // Fast path: use a recent Android/browser reading first. The server still
  // enforces its own freshness, accuracy and geofence rules.
  try {
    const warm = await readOnce({ ...WARM_OPTIONS, ...options });
    if (warm.accuracyMeters <= 100) return warm;
  } catch {
    // Fall through to acquisition.
  }

  const readings: AttendanceLocation[] = [];
  let lastError: AttendanceLocationError | null = null;

  // First request: balanced location. This is normally much faster than
  // forcing a cold GPS fix and is sufficient for our 100m server accuracy
  // limit.
  try {
    const fast = await readOnce({ ...FAST_OPTIONS, ...options });
    readings.push(fast);
    if (fast.accuracyMeters <= 100) return fast;
  } catch (error) {
    lastError = error instanceof AttendanceLocationError
      ? error
      : new AttendanceLocationError("position_unavailable", "Could not read GPS location.");
  }

  // Fallback: cold high-accuracy GPS. We only reach this when the fast
  // provider could not return a usable reading.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reading = await readOnce(merged);
      readings.push(reading);

      if (reading.accuracyMeters <= 100) return reading;
    } catch (error) {
      lastError = error instanceof AttendanceLocationError
        ? error
        : new AttendanceLocationError("position_unavailable", "Could not read GPS location.");
    }

    if (attempt < 1) await wait(400);
  }

  if (readings.length > 0) {
    return readings.reduce((best, current) =>
      current.accuracyMeters < best.accuracyMeters ? current : best,
    );
  }

  throw lastError ?? new AttendanceLocationError(
    "position_unavailable",
    "Could not read GPS location. Keep Location on and try again.",
  );
}
