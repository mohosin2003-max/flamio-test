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
    // Date controls are Dhaka calendar dates. Use a half-open UTC interval so
    // the end date is fully included and the next day is excluded.
    const startUtc = new Date(`${data.fromDate}T00:00:00+06:00`).toISOString();
    const endExclusive = new Date(new Date(`${data.toDate}T00:00:00+06:00`).getTime() + 86_400_000).toISOString();
    const nowIso = new Date().toISOString();
    const { data: targetEvents, error } = await db.from("attendance_location_events")
      .select("id, user_id, session_id, station_id, event_type, occurred_at, distance_from_site_m, accuracy_m")
      .gte("occurred_at", startUtc).lt("occurred_at", endExclusive).lte("occurred_at", nowIso)
      .order("occurred_at", { ascending: true }).limit(10000);
    if (error) {
      console.error("GPS movement report failed", error.message);
      throw new Error("GPS movement report could not be loaded. Confirm the TEST database migration.");
    }
    const targets = (targetEvents ?? []) as Array<Record<string, unknown>>;
    const sessionIds = [...new Set(targets.map((r) => String(r.session_id)))];
    const userIds = [...new Set(targets.map((r) => String(r.user_id)))];
    const stationIds = [...new Set(targets.map((r) => String(r.station_id)))];

    // Load the complete available event timeline for sessions that have an
    // event in the selected range. This lets an exit on the final selected
    // day be paired with a return that happened on a later day.
    const [historyRes, sessionsRes, profilesRes, stationsRes] = await Promise.all([
      sessionIds.length
        ? db.from("attendance_location_events")
            .select("id, user_id, session_id, station_id, event_type, occurred_at, distance_from_site_m, accuracy_m")
            .in("session_id", sessionIds).lte("occurred_at", nowIso)
            .order("occurred_at", { ascending: true }).limit(10000)
        : Promise.resolve({ data: [], error: null }),
      sessionIds.length
        ? db.from("attendance_sessions").select("id, shift_id, duty_date, clock_in_at, clock_out_at").in("id", sessionIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? db.from("profiles").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      stationIds.length
        ? db.from("attendance_stations").select("id, name").in("id", stationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (historyRes.error || sessionsRes.error || profilesRes.error || stationsRes.error) {
      console.error("GPS report enrichment failed", historyRes.error?.message, sessionsRes.error?.message, profilesRes.error?.message, stationsRes.error?.message);
      throw new Error("GPS report details could not be loaded.");
    }
    const history = (historyRes.data ?? []) as Array<Record<string, unknown>>;
    const sessions = (sessionsRes.data ?? []) as Array<{ id: string; shift_id: string | null; duty_date: string | null; clock_in_at: string | null; clock_out_at: string | null }>;
    const shiftIds = [...new Set(sessions.map((s) => s.shift_id).filter((id): id is string => Boolean(id)))];
    const shiftsRes = shiftIds.length
      ? await db.from("attendance_shifts").select("id, duty_role, shift_date, start_time, end_time, starts_at, ends_at").in("id", shiftIds)
      : { data: [], error: null };
    if (shiftsRes.error) throw new Error("Scheduled shift details could not be loaded.");

    const names = new Map<string, string>();
    for (const profile of (profilesRes.data ?? []) as Array<{ id: string; full_name: string | null }>) {
      names.set(profile.id, profile.full_name?.trim() || "Unnamed staff");
    }
    const stations = new Map<string, string>();
    for (const station of (stationsRes.data ?? []) as Array<{ id: string; name: string }>) stations.set(station.id, station.name);
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));
    const shiftMap = new Map(((shiftsRes.data ?? []) as Array<{ id: string; duty_role: string | null; shift_date: string | null; start_time: string | null; end_time: string | null; starts_at: string | null; ends_at: string | null }>).map((s) => [s.id, s]));
    const bySession = new Map<string, Array<Record<string, unknown>>>();
    for (const event of history) {
      const key = String(event.session_id);
      bySession.set(key, [...(bySession.get(key) ?? []), event]);
    }

    const rows = targets
      .filter((event) => event.event_type === "geofence_exit")
      .map((event) => {
        const sessionId = String(event.session_id);
        const timeline = bySession.get(sessionId) ?? [];
        const index = timeline.findIndex((item) => item.id === event.id);
        const returnEvent = timeline.slice(index + 1).find((item) => item.event_type === "reentry" || item.event_type === "geofence_enter");
        const exitAt = String(event.occurred_at);
        const returnAt = returnEvent ? String(returnEvent.occurred_at) : null;
        const outsideMinutes = returnAt ? Math.max(0, Math.round((Date.parse(returnAt) - Date.parse(exitAt)) / 60000)) : null;
        const session = sessionMap.get(sessionId);
        const shift = session?.shift_id ? shiftMap.get(session.shift_id) : undefined;
        return {
          id: String(event.id),
          userId: String(event.user_id),
          staffName: names.get(String(event.user_id)) ?? "Staff member",
          stationName: stations.get(String(event.station_id)) ?? "Station",
          sessionId,
          dutyDate: session?.duty_date ?? shift?.shift_date ?? null,
          shiftRole: shift?.duty_role ?? null,
          shiftStart: shift?.starts_at ?? shift?.start_time ?? null,
          shiftEnd: shift?.ends_at ?? shift?.end_time ?? null,
          clockInAt: session?.clock_in_at ?? null,
          clockOutAt: session?.clock_out_at ?? null,
          exitAt,
          returnAt,
          outsideMinutes,
          status: returnAt ? "Returned" as const : "Still outside / no return event" as const,
          distanceMeters: Number(event.distance_from_site_m),
          accuracyMeters: Number(event.accuracy_m),
        };
      })
      .sort((a, b) => b.exitAt.localeCompare(a.exitAt));

    const summaryMap = new Map<string, { userId: string; staffName: string; exits: number; completedTrips: number; outsideMinutes: number; currentlyOutside: number }>();
    for (const row of rows) {
      const item = summaryMap.get(row.userId) ?? { userId: row.userId, staffName: row.staffName, exits: 0, completedTrips: 0, outsideMinutes: 0, currentlyOutside: 0 };
      item.exits++;
      if (row.outsideMinutes === null) item.currentlyOutside++;
      else { item.completedTrips++; item.outsideMinutes += row.outsideMinutes; }
      summaryMap.set(row.userId, item);
    }
    return {
      rows,
      summary: [...summaryMap.values()].sort((a, b) => a.staffName.localeCompare(b.staffName)),
      truncated: targets.length >= 10000 || history.length >= 10000,
    };
  });
