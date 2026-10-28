import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ownerGetGpsMovementReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fromDate: dateKey, toDate: dateKey }).parse(input))
  .handler(async ({ data, context }) => {
    const { getAccessProfile } = await import("@/lib/owner.server");
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can view GPS movement reports.");
    if (data.toDate < data.fromDate) throw new Error("End date must be on or after the start date.");

    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const startUtc = new Date(`${data.fromDate}T00:00:00+06:00`).toISOString();
    const endDate = new Date(`${data.toDate}T00:00:00+06:00`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    const endUtc = endDate.toISOString();

    const { data: events, error } = await db.from("attendance_location_events")
      .select("id, user_id, session_id, station_id, event_type, occurred_at, distance_from_site_m, accuracy_m")
      .gte("occurred_at", startUtc).lt("occurred_at", endUtc)
      .order("occurred_at", { ascending: true }).limit(10000);
    if (error) {
      console.error("GPS movement report failed", error.message);
      throw new Error("GPS movement report could not be loaded. Confirm the TEST database migration.");
    }
    const rows = (events ?? []) as Array<Record<string, unknown>>;
    const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
    const stationIds = [...new Set(rows.map((r) => String(r.station_id)))];
    const [profilesRes, stationsRes] = await Promise.all([
      userIds.length ? db.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
      stationIds.length ? db.from("attendance_stations").select("id, name").in("id", stationIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesRes.error || stationsRes.error) throw new Error("GPS report names could not be loaded.");
    const names = new Map((profilesRes.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name?.trim() || "Unnamed staff"]));
    const stations = new Map((stationsRes.data ?? []).map((s: { id: string; name: string }) => [s.id, s.name]));
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of rows) {
      const key = String(row.session_id);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const reportRows = rows.map((row, index) => {
      const type = String(row.event_type);
      const group = groups.get(String(row.session_id)) ?? [];
      const position = group.findIndex((e) => e.id === row.id);
      let outsideMinutes: number | null = null;
      if (type === "geofence_exit") {
        const nextInside = group.slice(position + 1).find((e) => e.event_type === "reentry" || e.event_type === "geofence_enter");
        if (nextInside) outsideMinutes = Math.max(0, Math.round((Date.parse(String(nextInside.occurred_at)) - Date.parse(String(row.occurred_at))) / 60000));
      }
      return {
        id: String(row.id), staffName: names.get(String(row.user_id)) ?? "Staff member",
        stationName: stations.get(String(row.station_id)) ?? "Station",
        sessionId: String(row.session_id), eventType: type, occurredAt: String(row.occurred_at),
        distanceMeters: Number(row.distance_from_site_m), accuracyMeters: Number(row.accuracy_m),
        outsideMinutes, isUnreturned: type === "geofence_exit" && outsideMinutes === null,
      };
    });
    const summary = new Map<string, { staffName: string; exits: number; completedTrips: number; outsideMinutes: number; currentlyOutside: number }>();
    for (const row of reportRows) {
      const key = row.staffName;
      const item = summary.get(key) ?? { staffName: key, exits: 0, completedTrips: 0, outsideMinutes: 0, currentlyOutside: 0 };
      if (row.eventType === "geofence_exit") {
        item.exits++;
        if (row.outsideMinutes === null) item.currentlyOutside++;
        else { item.completedTrips++; item.outsideMinutes += row.outsideMinutes; }
      }
      summary.set(key, item);
    }
    return {
      rows: reportRows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      summary: [...summary.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)),
      truncated: rows.length >= 10000,
    };
  });
