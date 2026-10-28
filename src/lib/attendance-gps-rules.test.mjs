import { describe, expect, test } from "bun:test";
import { distanceMeters, findNextInsideEvent, getDhakaDateRange, gpsInput, summarizeGpsExits } from "./attendance-gps-rules.ts";

describe("GPS input validation", () => {
  const valid = { latitude: 23.728, longitude: 90.412, accuracyMeters: 12, capturedAt: 1_798_000_000_000 };
  test("accepts valid coordinates and accuracy boundaries", () => {
    expect(gpsInput.safeParse(valid).success).toBe(true);
    expect(gpsInput.safeParse({ ...valid, latitude: -90, longitude: 180, accuracyMeters: 0 }).success).toBe(true);
    expect(gpsInput.safeParse({ ...valid, latitude: 90, longitude: -180, accuracyMeters: 50 }).success).toBe(true);
  });
  test("rejects out-of-range, non-finite and malformed values", () => {
    for (const patch of [
      { latitude: 90.01 }, { latitude: -90.01 }, { longitude: 180.01 }, { longitude: -180.01 },
      { accuracyMeters: -0.1 }, { accuracyMeters: 50.1 }, { latitude: Number.NaN },
      { longitude: Number.POSITIVE_INFINITY }, { capturedAt: 1.5 }, { capturedAt: 0 },
    ]) expect(gpsInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe("GPS distance", () => {
  test("same coordinates yield zero distance", () => {
    expect(distanceMeters(23.7, 90.4, 23.7, 90.4)).toBe(0);
  });
  test("one degree latitude is approximately 111.2 km", () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeGreaterThan(111_000);
    expect(distanceMeters(0, 0, 1, 0)).toBeLessThan(111_300);
  });
  test("is symmetric and handles longitude wrap near the date line", () => {
    expect(Math.abs(distanceMeters(10, 20, 11, 21) - distanceMeters(11, 21, 10, 20))).toBeLessThan(0.001);
    expect(distanceMeters(0, 179.9, 0, -179.9)).toBeLessThan(23_000);
  });
});

describe("Dhaka report date range", () => {
  test("converts inclusive local dates into a half-open UTC interval", () => {
    expect(getDhakaDateRange("2026-10-28", "2026-10-28")).toEqual({
      startUtc: "2026-10-27T18:00:00.000Z",
      endExclusiveUtc: "2026-10-28T18:00:00.000Z",
    });
  });
  test("includes month/year boundaries without local-machine timezone dependence", () => {
    expect(getDhakaDateRange("2026-12-31", "2027-01-01")).toEqual({
      startUtc: "2026-12-30T18:00:00.000Z",
      endExclusiveUtc: "2027-01-02T18:00:00.000Z",
    });
  });
  test("rejects impossible dates and reversed ranges", () => {
    expect(() => getDhakaDateRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() => getDhakaDateRange("2026-10-29", "2026-10-28")).toThrow();
    expect(() => getDhakaDateRange("28-10-2026", "2026-10-28")).toThrow();
  });
});

describe("exit/return pairing", () => {
  const event = (id: string, event_type: string, occurred_at: string) => ({ id, event_type, occurred_at });
  test("pairs exit with first subsequent re-entry", () => {
    const timeline = [
      event("a", "geofence_enter", "2026-10-28T10:00:00Z"),
      event("b", "geofence_exit", "2026-10-28T11:00:00Z"),
      event("c", "geofence_exit", "2026-10-28T11:05:00Z"),
      event("d", "reentry", "2026-10-28T11:20:00Z"),
    ];
    expect(findNextInsideEvent(timeline, "b")?.id).toBe("d");
    expect(findNextInsideEvent(timeline, "c")?.id).toBe("d");
  });
  test("handles unsorted timeline and ignores unrelated event types", () => {
    const timeline = [
      event("return", "geofence_enter", "2026-10-28T12:00:00Z"),
      event("task", "task_completed", "2026-10-28T11:30:00Z"),
      event("exit", "geofence_exit", "2026-10-28T11:00:00Z"),
    ];
    expect(findNextInsideEvent(timeline, "exit")?.id).toBe("return");
  });
  test("unreturned or missing exit stays unpaired", () => {
    expect(findNextInsideEvent([event("exit", "geofence_exit", "2026-10-28T11:00:00Z")], "exit")).toBeNull();
    expect(findNextInsideEvent([], "missing")).toBeNull();
  });
});

describe("GPS exit summary", () => {
  test("groups by immutable user ID rather than duplicate display names", () => {
    const summary = summarizeGpsExits([
      { userId: "u1", staffName: "Staff", outsideMinutes: 10 },
      { userId: "u1", staffName: "Staff", outsideMinutes: null },
      { userId: "u2", staffName: "Staff", outsideMinutes: 7 },
    ]);
    expect(summary).toHaveLength(2);
    expect(summary.find((item) => item.userId === "u1")).toEqual({
      userId: "u1", staffName: "Staff", exits: 2, completedTrips: 1, outsideMinutes: 10, currentlyOutside: 1,
    });
  });
  test("zero-minute returns count as completed trips, not unreturned exits", () => {
    expect(summarizeGpsExits([{ userId: "u", staffName: "A", outsideMinutes: 0 }])[0]).toMatchObject({
      exits: 1, completedTrips: 1, outsideMinutes: 0, currentlyOutside: 0,
    });
  });
});
