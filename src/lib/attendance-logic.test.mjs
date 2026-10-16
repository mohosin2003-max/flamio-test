import { describe, expect, test } from "bun:test";

import { dhakaDate, distanceMeters, evaluateGeofence, retentionCutoff, retentionEligible } from "./attendance-logic.ts";

const station = { lat: 23.8103, lng: 90.4125, radius: 50 };
const now = Date.parse("2026-10-16T04:00:00Z");

describe("geofence", () => {
  test("inside station passes", () => {
    const r = evaluateGeofence({ point: { lat: 23.8103, lng: 90.4126, accuracy: 10, capturedAt: now }, station, now });
    expect(r.ok).toBe(true);
  });
  test("~200m away is outside", () => {
    const r = evaluateGeofence({ point: { lat: 23.8121, lng: 90.4125, accuracy: 10, capturedAt: now }, station, now });
    expect(r).toMatchObject({ ok: false, reason: "outside" });
  });
  test("stale reading older than 2 minutes rejected", () => {
    const r = evaluateGeofence({ point: { ...station, accuracy: 5, capturedAt: now - 121_000 }, station, now });
    expect(r).toMatchObject({ ok: false, reason: "stale" });
  });
  test("accuracy worse than 100m rejected", () => {
    const r = evaluateGeofence({ point: { ...station, accuracy: 150, capturedAt: now }, station, now });
    expect(r).toMatchObject({ ok: false, reason: "inaccurate" });
  });
  test("invalid coordinates rejected", () => {
    const r = evaluateGeofence({ point: { lat: 200, lng: 0, accuracy: 5, capturedAt: now }, station, now });
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
  });
  test("distance sanity", () => {
    expect(Math.round(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 1000)).toBe(111);
  });
});

describe("retention cutoff (Asia/Dhaka, one calendar month)", () => {
  test("16 Oct 10:00 Dhaka -> 16 Sep 00:00 Dhaka", () => {
    expect(retentionCutoff(new Date("2026-10-16T04:00:00Z")).toISOString()).toBe("2026-09-15T18:00:00.000Z");
  });
  test("31 Mar clamps to end of Feb", () => {
    expect(retentionCutoff(new Date("2026-03-31T06:00:00Z")).toISOString()).toBe("2026-02-27T18:00:00.000Z");
  });
  test("UTC evening already next Dhaka day", () => {
    expect(dhakaDate(new Date("2026-10-15T19:00:00Z"))).toBe("2026-10-16");
  });
  test("active records are never eligible", () => {
    const cutoff = new Date("2026-09-15T18:00:00Z");
    const rows = [
      { id: "old", endedAt: "2026-09-01T00:00:00Z" },
      { id: "open", endedAt: null },
      { id: "recent", endedAt: "2026-10-01T00:00:00Z" },
      { id: "boundary", endedAt: "2026-09-15T18:00:00Z" },
    ];
    expect(retentionEligible(rows, cutoff).map((r) => r.id)).toEqual(["old"]);
  });
});
