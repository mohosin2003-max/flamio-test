import { describe, expect, test } from "bun:test";
import { appendFlags, decideClockOutLocation, EXCEPTION_REQUIRED_PREFIX, parseExceptionRequired, validateClockInLocationTimestamp } from "./attendance-clockout.ts";

const now = Date.parse("2026-10-23T12:00:00Z");
const station = { latitude: 23.8103, longitude: 90.4125, radius: 50, isActive: true };
const inside = { latitude: 23.8103, longitude: 90.4126, accuracyMeters: 10, capturedAt: now };
const outside = { latitude: 23.8121, longitude: 90.4125, accuracyMeters: 10, capturedAt: now };
const base = { geofenceEnabled: true, sessionUserId: "a", callerId: "a", station, point: inside, now };
const REASON = "Closed the shop and left the premises";

describe("clock-in GPS freshness", () => {
  test("accepts a fresh timestamp", () => expect(validateClockInLocationTimestamp(now, now)).toEqual({ ok: true }));
  test("rejects missing timestamp", () => expect(validateClockInLocationTimestamp(undefined, now)).toEqual({ ok: false, reason: "missing" }));
  test("rejects timestamp older than two minutes", () => expect(validateClockInLocationTimestamp(now - 120_001, now)).toEqual({ ok: false, reason: "stale" }));
  test("rejects timestamp too far in the future", () => expect(validateClockInLocationTimestamp(now + 30_001, now)).toEqual({ ok: false, reason: "invalid" }));
  test("tolerates small device clock skew", () => expect(validateClockInLocationTimestamp(now + 10_000, now)).toEqual({ ok: true }));
});

describe("clock-out geofence", () => {
  test("inside radius passes as verified location", () => {
    expect(decideClockOutLocation(base)).toMatchObject({ ok: true, mode: "verified_location" });
  });
  test("outside radius without reason is rejected and asks for a reason", () => {
    const r = decideClockOutLocation({ ...base, point: outside });
    expect(r).toMatchObject({ ok: false, needsReason: true, discrepancy: "outside_geofence" });
    expect(r.error.startsWith(EXCEPTION_REQUIRED_PREFIX)).toBe(true);
    expect(parseExceptionRequired(r.error).discrepancy).toBe("outside_geofence");
  });
  test("outside radius with reason becomes an auditable exception", () => {
    expect(decideClockOutLocation({ ...base, point: outside, exceptionReason: REASON })).toMatchObject({ ok: true, mode: "exception", discrepancy: "outside_geofence", reason: REASON });
  });
  test("too-short reason is refused", () => {
    expect(decideClockOutLocation({ ...base, point: outside, exceptionReason: "bye" })).toMatchObject({ ok: false, needsReason: true });
  });
  test("missing coordinates / GPS permission failure needs a reason", () => {
    expect(decideClockOutLocation({ ...base, point: {} })).toMatchObject({ ok: false, discrepancy: "no_location" });
    expect(decideClockOutLocation({ ...base, point: {}, exceptionReason: "GPS permission denied on my phone" })).toMatchObject({ ok: true, mode: "exception", discrepancy: "no_location" });
  });
  test("accuracy over 50 m is not accepted as verified", () => {
    expect(decideClockOutLocation({ ...base, point: { ...inside, accuracyMeters: 51 } })).toMatchObject({ ok: false, discrepancy: "inaccurate_location" });
  });
  test("reading older than 2 minutes is stale", () => {
    expect(decideClockOutLocation({ ...base, point: { ...inside, capturedAt: now - 121_000 } })).toMatchObject({ ok: false, discrepancy: "stale_location" });
  });
  test("geofencing disabled keeps normal clock-out without location", () => {
    expect(decideClockOutLocation({ ...base, geofenceEnabled: false, point: {}, station: null })).toMatchObject({ ok: true, mode: "normal" });
  });
  test("missing or inactive station never falls back to a verified clock-out", () => {
    expect(decideClockOutLocation({ ...base, station: null })).toMatchObject({ ok: false, discrepancy: "station_unverifiable" });
    expect(decideClockOutLocation({ ...base, station: { ...station, isActive: false } })).toMatchObject({ ok: false, discrepancy: "station_unverifiable" });
    expect(decideClockOutLocation({ ...base, station: { ...station, latitude: null } }).ok).toBe(false);
  });
  test("another staff member's session is refused even with a reason", () => {
    expect(decideClockOutLocation({ ...base, callerId: "b", exceptionReason: REASON })).toMatchObject({ ok: false, needsReason: false });
  });
  test("existing flags kept, discrepancy flags appended once", () => {
    expect(appendFlags(["late"], ["clock_out_location_exception", "outside_geofence"])).toEqual(["late", "clock_out_location_exception", "outside_geofence"]);
    expect(appendFlags(["late", "outside_geofence"], ["outside_geofence"])).toEqual(["late", "outside_geofence"]);
    expect(appendFlags(null, ["no_location"])).toEqual(["no_location"]);
  });
});
