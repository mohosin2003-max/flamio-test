import { createServerFn } from "@tanstack/react-start";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * TEST-only Attendance management endpoints.
 *
 * Every operation is authorized on the server. This file intentionally reuses
 * existing attendance tables and does not require a schema migration.
 * Do not expose phone numbers through these endpoints.
 */
const stationInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  geofenceRadiusMeters: z.number().int().min(25).max(1000).default(100),
}).refine((value) => (value.latitude == null) === (value.longitude == null), "Latitude and longitude must both be supplied.");

const shiftInput = z.object({
  userId: z.string().uuid(),
  stationId: z.string().uuid().nullable().optional(),
  dutyRole: z.string().trim().max(80).nullable().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  plannedBreakMinutes: z.number().int().min(0).max(240).default(0),
  notes: z.string().trim().max(500).nullable().optional(),
});

async function requireAttendanceOwner(userId: string) {
  const { getAccessProfile } = await import("@/lib/owner.server");
  const access = await getAccessProfile(userId);
  if (!access.isOwner) throw new Error("Only the Owner can manage attendance schedules and stations.");
}

function shiftTimestamps(date: string, start: string, end: string) {
  const startTime = start.length === 5 ? `${start}:00` : start;
  const endTime = end.length === 5 ? `${end}:00` : end;
  const overnight = endTime <= startTime;
  // Convert the restaurant-local Asia/Dhaka wall clock to UTC explicitly (UTC+6).
  const toUtcIso = (d: string, t: string) => {
    const year = Number(d.slice(0, 4));
    const month = Number(d.slice(5, 7));
    const day = Number(d.slice(8, 10));
    const hour = Number(t.slice(0, 2));
    const minute = Number(t.slice(3, 5));
    const second = Number(t.slice(6, 8));
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
      throw new Error("Invalid shift date or time.");
    }
    return new Date(Date.UTC(year, month - 1, day, hour - 6, minute, second)).toISOString();
  };
  const startAt = toUtcIso(date, startTime);
  const endDate = overnight
    ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + 1))
        .toISOString().slice(0, 10)
    : date;
  const endAt = toUtcIso(endDate, endTime);
  if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("Shift end must be after shift start.");
  if (Date.parse(endAt) - Date.parse(startAt) > 18 * 60 * 60 * 1000) {
    throw new Error("A shift cannot exceed 18 hours.");
  }
  return { startTime: startTime.slice(0, 5), endTime: endTime.slice(0, 5), startAt, endAt, overnight };
}

export const ownerListAttendanceManagement = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const [stationsResult, shiftsResult, profilesResult, tasksResult] = await Promise.all([
      db.from("attendance_stations")
        .select("id, name, description, is_active, sort_order, latitude, longitude, geofence_radius_meters")
        .order("sort_order")
        .order("name"),
      db.from("attendance_shifts")
        .select("id, user_id, station_id, duty_role, shift_date, start_time, end_time, starts_at, ends_at, is_overnight, planned_break_minutes, status, notes")
        .gte("shift_date", new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
        .order("shift_date", { ascending: false })
        .limit(200),
      db.from("user_roles").select("user_id").eq("role", "staff"),
      db.from("attendance_tasks").select("id, assigned_to, title, description, due_date, due_at, priority, status, requires_verification, completed_at, completion_note, review_note").order("due_date", { ascending: false }).limit(200),
    ]);
    if (stationsResult.error || shiftsResult.error || profilesResult.error || tasksResult.error) {
      console.error("Attendance management read failed", {
        stations: stationsResult.error?.message,
        shifts: shiftsResult.error?.message,
        staffRoles: profilesResult.error?.message,
        tasks: tasksResult.error?.message,
      });
      throw new Error("Attendance management could not be loaded.");
    }
    const staffIds = Array.from(new Set((profilesResult.data ?? []).map((row: { user_id: string }) => row.user_id)));
    const { data: staffProfiles, error: staffProfilesError } = staffIds.length
      ? await db.from("profiles").select("id, full_name").in("id", staffIds)
      : { data: [], error: null };
    if (staffProfilesError) throw new Error("Staff directory could not be loaded.");
    const names = new Map((staffProfiles ?? []).map((p: { id: string; full_name: string | null }) => [
      p.id, p.full_name?.trim() || "Unnamed staff",
    ]));
    return {
      stations: (stationsResult.data ?? []).map((s: Record<string, unknown>) => ({
        id: String(s.id), name: String(s.name), description: s.description ? String(s.description) : null,
        isActive: Boolean(s.is_active), sortOrder: Number(s.sort_order ?? 0),
        latitude: s.latitude == null ? null : Number(s.latitude),
        longitude: s.longitude == null ? null : Number(s.longitude),
        geofenceRadiusMeters: Number(s.geofence_radius_meters ?? 100),
      })),
      tasks: (tasksResult.data ?? []).map((t: Record<string, unknown>) => ({
        id: String(t.id), assignedTo: String(t.assigned_to), staffName: names.get(String(t.assigned_to)) ?? "Staff member",
        title: String(t.title), description: t.description ? String(t.description) : null,
        dueDate: String(t.due_date), dueAt: t.due_at ? String(t.due_at) : null,
        priority: String(t.priority), status: String(t.status), requiresVerification: Boolean(t.requires_verification),
        completedAt: t.completed_at ? String(t.completed_at) : null,
        completionNote: t.completion_note ? String(t.completion_note) : null,
        reviewNote: t.review_note ? String(t.review_note) : null,
      })),
      shifts: (shiftsResult.data ?? []).map((s: Record<string, unknown>) => ({
        id: String(s.id), userId: String(s.user_id), staffName: names.get(String(s.user_id)) ?? "Staff member",
        stationId: s.station_id ? String(s.station_id) : null, dutyRole: s.duty_role ? String(s.duty_role) : null,
        shiftDate: String(s.shift_date), startTime: String(s.start_time), endTime: String(s.end_time),
        startsAt: String(s.starts_at), endsAt: String(s.ends_at), isOvernight: Boolean(s.is_overnight),
        plannedBreakMinutes: Number(s.planned_break_minutes ?? 0), status: String(s.status),
        notes: s.notes ? String(s.notes) : null,
      })),
      staff: (staffProfiles ?? []).map((p: { id: string; full_name: string | null }) => ({
        id: p.id, name: p.full_name?.trim() || "Unnamed staff",
      })),
    };
  });

export const ownerCreateAttendanceStation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => stationInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { error } = await db.from("attendance_stations").insert({
      name: data.name,
      description: data.description ?? null,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      geofence_radius_meters: data.geofenceRadiusMeters,
      created_by: context.userId,
    });
    if (error) {
      console.error("Attendance station create failed", error.message);
      throw new Error("Could not create station.");
    }
    return { ok: true };
  });

export const ownerUpdateAttendanceStation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ stationId: z.string().uuid(), isActive: z.boolean().optional(), name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).nullable().optional(), latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(), geofenceRadiusMeters: z.number().int().min(25).max(1000).default(100) }).refine((value) => (value.latitude == null) === (value.longitude == null), "Latitude and longitude must both be supplied.").parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { stationId, isActive, ...fields } = data;
    const update: Record<string, unknown> = {
      name: fields.name,
      description: fields.description ?? null,
      latitude: fields.latitude ?? null,
      longitude: fields.longitude ?? null,
      geofence_radius_meters: fields.geofenceRadiusMeters,
    };
    if (isActive !== undefined) update.is_active = isActive;
    const { data: station, error } = await db.from("attendance_stations")
      .update(update).eq("id", stationId).select("id").maybeSingle();
    if (error || !station) {
      console.error("Attendance station update failed", error?.message ?? "Station not found");
      throw new Error("Could not update station.");
    }
    return { ok: true };
  });

export const ownerIssueAttendanceQrChallenge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ stationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: station, error: stationError } = await db.from("attendance_stations")
      .select("id, name, is_active").eq("id", data.stationId).maybeSingle();
    if (stationError || !station?.is_active) throw new Error("Choose an active station to generate a QR challenge.");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { error } = await db.from("attendance_qr_challenges").insert({
      station_id: station.id, token_hash: tokenHash, created_by: context.userId, expires_at: expiresAt,
    });
    if (error) {
      console.error("Attendance QR challenge issue failed", error.message);
      throw new Error("Could not generate a station QR challenge.");
    }
    return { stationId: station.id, stationName: station.name, token, expiresAt };
  });

export const ownerSetAttendanceStationActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { error } = await db.from("attendance_stations").update({ is_active: data.isActive }).eq("id", data.id);
    if (error) {
      console.error("Attendance station update failed", error.message);
      throw new Error("Could not update station.");
    }
    return { ok: true };
  });

export const ownerCreateAttendanceShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shiftInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const dateParts = data.shiftDate.split("-").map(Number);
    const year = dateParts[0] ?? Number.NaN;
    const month = dateParts[1] ?? Number.NaN;
    const day = dateParts[2] ?? Number.NaN;
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== data.shiftDate) {
      throw new Error("Invalid shift date.");
    }
    const timestamps = shiftTimestamps(data.shiftDate, data.startTime, data.endTime);
    const { data: staffRole, error: roleError } = await db.from("user_roles")
      .select("user_id").eq("user_id", data.userId).eq("role", "staff").maybeSingle();
    if (roleError || !staffRole) throw new Error("Choose an existing staff account.");
    if (data.stationId) {
      const { data: station, error: stationError } = await db.from("attendance_stations")
        .select("id").eq("id", data.stationId).eq("is_active", true).maybeSingle();
      if (stationError || !station) throw new Error("Choose an active station.");
    }
    // Conservative overlap check: prevent overlapping active shifts for the same person.
    const { data: existing, error: overlapError } = await db.from("attendance_shifts")
      .select("id, starts_at, ends_at")
      .eq("user_id", data.userId)
      .eq("status", "scheduled")
      .lt("starts_at", timestamps.endAt)
      .gt("ends_at", timestamps.startAt)
      .limit(1);
    if (overlapError) {
      console.error("Attendance shift overlap check failed", overlapError.message);
      throw new Error("Could not verify schedule overlap; no shift was created.");
    }
    if ((existing ?? []).length) throw new Error("This staff member already has an overlapping scheduled shift.");
    const { error } = await db.from("attendance_shifts").insert({
      user_id: data.userId, station_id: data.stationId ?? null, duty_role: data.dutyRole ?? null,
      shift_date: data.shiftDate, start_time: timestamps.startTime, end_time: timestamps.endTime,
      starts_at: timestamps.startAt, ends_at: timestamps.endAt, is_overnight: timestamps.overnight,
      planned_break_minutes: data.plannedBreakMinutes, notes: data.notes ?? null, created_by: context.userId,
    });
    if (error) {
      console.error("Attendance shift create failed", error.message);
      throw new Error("Could not create shift.");
    }
    return { ok: true };
  });

export const ownerCancelAttendanceShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: current, error: readError } = await db.from("attendance_shifts")
      .select("id, status").eq("id", data.id).maybeSingle();
    if (readError || !current) throw new Error("Shift was not found.");
    if (current.status !== "scheduled") throw new Error("Only scheduled shifts can be cancelled.");
    const { error } = await db.from("attendance_shifts").update({ status: "cancelled" }).eq("id", data.id).eq("status", "scheduled");
    if (error) {
      console.error("Attendance shift cancel failed", error.message);
      throw new Error("Could not cancel shift.");
    }
    return { ok: true };
  });

const shiftUpdateInput = z.object({
  id: z.string().uuid(),
  stationId: z.string().uuid().nullable().optional(),
  dutyRole: z.string().trim().max(80).nullable().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/),
  plannedBreakMinutes: z.number().int().min(0).max(240).default(0),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * Owner edit of an unstarted scheduled shift. The staff member cannot be
 * changed (cancel and recreate instead). Overlap is checked excluding this
 * shift; the database exclusion constraint remains the final guard.
 */
export const ownerUpdateAttendanceShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => shiftUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireAttendanceOwner(context.userId);
    const { shiftEditEligibility, findOverlapExcluding, isShiftOverlapConstraintError, validatePlannedBreak } = await import("@/lib/attendance-rules");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const parsedDate = new Date(`${data.shiftDate}T00:00:00Z`);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== data.shiftDate) throw new Error("Invalid shift date.");
    const { data: current, error: readError } = await db.from("attendance_shifts")
      .select("id, user_id, station_id, duty_role, shift_date, start_time, end_time, starts_at, ends_at, is_overnight, planned_break_minutes, status, notes")
      .eq("id", data.id).maybeSingle();
    if (readError || !current) throw new Error("Shift was not found.");
    const eligible = shiftEditEligibility(current, Date.now());
    if (!eligible.ok) throw new Error(eligible.reason);
    const timestamps = shiftTimestamps(data.shiftDate, data.startTime, data.endTime);
    if (Date.parse(timestamps.startAt) <= Date.now()) throw new Error("The new start time must be in the future.");
    validatePlannedBreak(timestamps.startAt, timestamps.endAt, data.plannedBreakMinutes);
    if (data.stationId) {
      const { data: station, error: stationError } = await db.from("attendance_stations")
        .select("id").eq("id", data.stationId).eq("is_active", true).maybeSingle();
      if (stationError || !station) throw new Error("Choose an active station.");
    }
    const { data: others, error: overlapError } = await db.from("attendance_shifts")
      .select("id, starts_at, ends_at, status")
      .eq("user_id", current.user_id).neq("id", current.id)
      .lt("starts_at", timestamps.endAt).gt("ends_at", timestamps.startAt).limit(20);
    if (overlapError) {
      console.error("Attendance shift overlap check failed", overlapError.message);
      throw new Error("Could not verify schedule overlap; the shift was not changed.");
    }
    const clash = findOverlapExcluding((others ?? []).map((o: { id: string; starts_at: string; ends_at: string; status: string }) => ({ id: o.id, startAt: o.starts_at, endAt: o.ends_at, status: o.status })), current.id, timestamps);
    if (clash) throw new Error("This staff member already has an overlapping shift.");
    const updated = {
      station_id: data.stationId ?? null, duty_role: data.dutyRole ?? null,
      shift_date: data.shiftDate, start_time: timestamps.startTime, end_time: timestamps.endTime,
      starts_at: timestamps.startAt, ends_at: timestamps.endAt, is_overnight: timestamps.overnight,
      planned_break_minutes: data.plannedBreakMinutes, notes: data.notes ?? null,
    };
    const { data: saved, error } = await db.from("attendance_shifts").update(updated)
      .eq("id", current.id).eq("status", "scheduled").select("id").maybeSingle();
    if (error) {
      if (isShiftOverlapConstraintError(error)) throw new Error("This staff member already has an overlapping shift.");
      console.error("Attendance shift update failed", error.message);
      throw new Error("Could not update shift.");
    }
    if (!saved) throw new Error("The shift changed before saving. Refresh and try again.");
    const { error: auditError } = await db.from("attendance_audit_log").insert({
      table_name: "attendance_shifts", row_id: current.id, action: "UPDATE", actor_id: context.userId,
      subject_user_id: current.user_id, old_data: current, new_data: { ...updated, _attendance_event: "shift_edited" },
    });
    if (auditError) console.error("Attendance shift edit audit failed", auditError.message);
    return { ok: true };
  });
