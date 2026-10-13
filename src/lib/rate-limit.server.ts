import { getRequest } from "@tanstack/react-start/server";

/**
 * Shared best-effort abuse protection for public server functions.
 *
 * Limits are keyed on the CALLER (IP address), not on the identity being
 * probed, so an attacker cannot bypass them by rotating phone numbers,
 * emails, or order codes.
 *
 * Storage is a per-worker in-memory sliding window: the project runs on
 * stateless serverless workers, so this is best-effort rather than a hard
 * global cap — but each worker still caps a probing caller, which breaks
 * bulk scripts in practice. No database table is used, per the project's
 * no-schema-change constraint.
 */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_TRACKED_KEYS = 5000;

/** Caller IP from trusted proxy headers; "unknown" when unavailable. */
export function callerKey(): string {
  try {
    const request = getRequest();
    const headers = request?.headers;
    if (!headers) return "unknown";
    const cf = headers.get("cf-connecting-ip");
    if (cf) return cf.trim();
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0];
      if (first) return first.trim();
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export type RateLimiter = {
  /** True when the caller is over the limit. Does NOT record an attempt. */
  isLimited: (key: string) => boolean;
  /** Record one attempt for the caller. */
  record: (key: string) => void;
  /** True when over the limit; otherwise records one attempt. */
  checkAndRecord: (key: string) => boolean;
};

/** Creates an independent sliding-window limiter with its own counter. */
export function createRateLimiter(maxPerWindow: number): RateLimiter {
  const log = new Map<string, number[]>();

  const recentFor = (key: string): number[] => {
    const now = Date.now();
    // Bound memory: drop the whole log if it grows past the cap.
    if (log.size > MAX_TRACKED_KEYS) log.clear();
    return (log.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  };

  return {
    isLimited(key) {
      const recent = recentFor(key);
      log.set(key, recent);
      return recent.length >= maxPerWindow;
    },
    record(key) {
      const recent = recentFor(key);
      recent.push(Date.now());
      log.set(key, recent);
    },
    checkAndRecord(key) {
      const recent = recentFor(key);
      if (recent.length >= maxPerWindow) {
        log.set(key, recent);
        return true;
      }
      recent.push(Date.now());
      log.set(key, recent);
      return false;
    },
  };
}
