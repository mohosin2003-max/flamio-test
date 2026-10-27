/**
 * Pure, browser-safe rules for mandatory check-in photo evidence.
 * Photos are stored as private evidence for human Owner/Manager review.
 */
export const SELFIE_BUCKET = "attendance-evidence";
export const SELFIE_MAX_BYTES = 1_500_000;
export const SELFIE_MIN_BYTES = 2_000;
/** A captured selfie must be used for clock-in within this window. */
export const SELFIE_MAX_AGE_MS = 10 * 60 * 1000;
/** Owner review links expire quickly. */
export const SELFIE_SIGNED_URL_SECONDS = 600;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function dhakaDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Server builds the path from the authenticated user id — never from client input. */
export function buildSelfiePath(userId: string, at: Date, id: string): string {
  if (!new RegExp(`^${UUID}$`, "i").test(userId) || !new RegExp(`^${UUID}$`, "i").test(id)) throw new Error("Invalid selfie path parts.");
  return `${userId.toLowerCase()}/${dhakaDate(at)}/${at.getTime()}-${id.toLowerCase()}.jpg`;
}

export type SelfieCaptureTimeCheck = { ok: true } | { ok: false; reason: string };

/** Reject stale or implausibly future capture times before storing photo evidence. */
export function validateSelfieCaptureTime(capturedAt: unknown, now: number): SelfieCaptureTimeCheck {
  if (typeof capturedAt !== "number" || !Number.isSafeInteger(capturedAt) || capturedAt <= 0) return { ok: false, reason: "Capture time is invalid. Take a new check-in photo." };
  if (capturedAt > now + 60_000) return { ok: false, reason: "The device time is incorrect. Check your phone clock and retake the photo." };
  if (now - capturedAt > SELFIE_MAX_AGE_MS) return { ok: false, reason: "Your check-in photo has expired. Take a new one." };
  return { ok: true };
}

export type SelfiePathCheck = { ok: true; capturedAt: number } | { ok: false; reason: string };

/** Verifies a path belongs to this user and is fresh. */
export function checkSelfiePath(path: unknown, userId: string, now: number): SelfiePathCheck {
  if (typeof path !== "string" || path.length > 200) return { ok: false, reason: "Check-in photo is missing." };
  const m = new RegExp(`^(${UUID})/(\\d{4}-\\d{2}-\\d{2})/(\\d{13})-(${UUID})\\.jpg$`).exec(path);
  if (!m) return { ok: false, reason: "Check-in photo is invalid." };
  if (m[1] !== userId.toLowerCase()) return { ok: false, reason: "This photo does not belong to your account." };
  const capturedAt = Number(m[3]);
  if (dhakaDate(new Date(capturedAt)) !== m[2]) return { ok: false, reason: "Check-in photo is invalid." };
  if (capturedAt > now + 60_000) return { ok: false, reason: "Check-in photo is invalid." };
  if (now - capturedAt > SELFIE_MAX_AGE_MS) return { ok: false, reason: "Your check-in photo has expired. Take a new one." };
  return { ok: true, capturedAt };
}

/** Only real JPEG bytes within size limits are accepted. */
export function validateSelfieBytes(bytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  if (bytes.length < SELFIE_MIN_BYTES) return { ok: false, reason: "The photo is empty or too small. Retake it." };
  if (bytes.length > SELFIE_MAX_BYTES) return { ok: false, reason: "The photo is too large. Retake it." };
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { ok: false, reason: "Only camera JPEG photos are accepted." };
  return { ok: true };
}

export type SelfieGate = { required: false } | { required: true; available: boolean; reason?: string };

/** Fail closed: if the Owner requires selfies but storage/columns are not ready, block clock-in. */
export function selfieGate(input: { columnsPresent: boolean }): SelfieGate {
  if (!input.columnsPresent) return { required: true, available: false, reason: "Check-in photo storage is not ready. Ask the Owner to contact support." };
  return { required: true, available: true };
}

/** Clock-out and break-end are never gated by a selfie, so staff can't be trapped on duty. */
export function selfieRequiredFor(kind: "clock_in" | "clock_out" | "break_start" | "break_end"): boolean {
  return kind === "clock_in";
}

export function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
