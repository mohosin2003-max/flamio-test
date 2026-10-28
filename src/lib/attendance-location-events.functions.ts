import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";

const gpsInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(50),
  capturedAt: z.number().int().positive(),
});

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Records geofence transitions only. Coordinates are used transiently for
 * server-side distance calculation and are never stored.
 */
export const staffRecordGpsTransition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => gpsInput.parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isStaff || access.isOwner || access.isManager) throw new Error("Only staff accounts can record duty GPS events.");
    const now = Date.now();
    if (data.capturedAt > now + 30_000 || now - data.capturedAt > 120_000) {
      throw new Error("GPS reading is stale. Refresh your location.");
    }
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: settings, error: settingsError } = await db.from("attendance_settings")
      .select("geofence_enabled, attendance_alerts_enabled").eq("id", true).maybeSingle();
    if (settingsError || !settings?.geofence_enabled) return { recorded: false, reason: "geofence_disabled" as const };

    const { data: session, error: sessionError } = await db.from("attendance_sessions")
      .select("id, shift_id").eq("user_id", context.userId).is("clock_out_at", null)
      .order("clock_in_at", { ascending: false }).limit(1).maybeSingle();
    if (sessionError) throw new Error("Could not verify the active duty session.");
    if (!session?.shift_id) return { recorded: false, reason: "no_station_shift" as const };
    const { data: shift, error: shiftError } = await db.from("attendance_shifts")
      .select("station_id").eq("id", session.shift_id).eq("user_id", context.userId).maybeSingle();
    if (shiftError || !shift?.station_id) return { recorded: false, reason: "no_station_shift" as const };
    const { data: station, error: stationError } = await db.from("attendance_stations")
      .select("id, latitude, longitude, geofence_radius_meters, is_active")
      .eq("id", shift.station_id).maybeSingle();
    if (stationError || !station?.is_active || station.latitude == null || station.longitude == null) {
      return { recorded: false, reason: "station_unconfigured" as const };
    }
    const distance = distanceMeters(data.latitude, data.longitude, Number(station.latitude), Number(station.longitude));
    const inside = distance <= Number(station.geofence_radius_meters);
    const { data: previous, error: previousError } = await db.from("attendance_location_events")
      .select("event_type").eq("session_id", session.id).order("occurred_at", { ascending: false }).limit(1).maybeSingle();
    if (previousError) throw new Error("Could not check the previous GPS event.");

    let eventType: "geofence_enter" | "geofence_exit" | "reentry" | null = null;
    if (!previous) eventType = inside ? "geofence_enter" : null;
    else if (inside && previous.event_type === "geofence_exit") eventType = "reentry";
    else if (!inside && previous.event_type !== "geofence_exit") eventType = "geofence_exit";
    if (!eventType) return { recorded: false, reason: "no_transition" as const, inside };

    const occurredAt = new Date(data.capturedAt).toISOString();
    const { error: insertError } = await db.from("attendance_location_events").insert({
      user_id: context.userId, session_id: session.id, station_id: station.id,
      event_type: eventType, occurred_at: occurredAt,
      distance_from_site_m: Math.round(distance * 100) / 100,
      accuracy_m: Math.round(data.accuracyMeters * 100) / 100,
    });
    if (insertError) {
      console.error("Attendance GPS event insert failed", insertError.message);
      throw new Error("GPS movement event could not be saved.");
    }
    if (settings.attendance_alerts_enabled && (eventType === "geofence_exit" || eventType === "reentry")) {
      const { sendGpsGeofenceAlert } = await import("@/lib/attendance-push.server");
      await sendGpsGeofenceAlert({
        sessionId: session.id, userId: context.userId, eventType,
        occurredAt, distanceMeters: Math.round(distance),
      });
    }
    return { recorded: true, eventType, inside, distanceMeters: Math.round(distance) };
  });
