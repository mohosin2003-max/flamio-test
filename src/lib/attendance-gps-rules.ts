import { z } from "zod";

export const gpsInput = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().min(0).max(50),
  capturedAt: z.number().int().positive(),
});

export type GpsEvent = {
  id: string;
  event_type: string;
  occurred_at: string;
};

export type GpsExitSummaryRow = {
  userId: string;
  staffName: string;
  outsideMinutes: number | null;
};

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isRealCalendarDate(value: string): boolean {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Converts inclusive Bangladesh calendar dates into a half-open UTC interval. */
export function getDhakaDateRange(fromDate: string, toDate: string): { startUtc: string; endExclusiveUtc: string } {
  if (!isRealCalendarDate(fromDate) || !isRealCalendarDate(toDate)) {
    throw new Error("Dates must be valid YYYY-MM-DD calendar dates.");
  }
  if (toDate < fromDate) throw new Error("End date must be on or after the start date.");
  const start = new Date(`${fromDate}T00:00:00+06:00`);
  const end = new Date(`${toDate}T00:00:00+06:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startUtc: start.toISOString(), endExclusiveUtc: end.toISOString() };
}

/** Finds the first subsequent inside/re-entry event in the same already-filtered session timeline. */
export function findNextInsideEvent(events: GpsEvent[], exitEventId: string): GpsEvent | null {
  const ordered = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const index = ordered.findIndex((event) => event.id === exitEventId);
  if (index < 0) return null;
  return ordered.slice(index + 1).find((event) =>
    event.event_type === "reentry" || event.event_type === "geofence_enter"
  ) ?? null;
}

export function summarizeGpsExits(rows: GpsExitSummaryRow[]) {
  const summary = new Map<string, { userId: string; staffName: string; exits: number; completedTrips: number; outsideMinutes: number; unreturnedExits: number }>();
  for (const row of rows) {
    const item = summary.get(row.userId) ?? {
      userId: row.userId, staffName: row.staffName, exits: 0, completedTrips: 0, outsideMinutes: 0, unreturnedExits: 0,
    };
    item.exits += 1;
    if (row.outsideMinutes === null) item.unreturnedExits += 1;
    else {
      item.completedTrips += 1;
      item.outsideMinutes += row.outsideMinutes;
    }
    summary.set(row.userId, item);
  }
  return [...summary.values()].sort((a, b) => a.staffName.localeCompare(b.staffName));
}
