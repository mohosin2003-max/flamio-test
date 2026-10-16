import { createServerFn } from "@tanstack/react-start";
import { createHash } from "node:crypto";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";

const noteSchema = z.string().trim().max(500).nullable().optional();

async function dbForUser(userId: string) {
  const access = await getAccessProfile(userId);
  if (!access.isStaff && !access.isOwner) {
    throw new Error("Only authorized staff or the Owner can access attendance operations.");
  }
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return { access, db: await untypedAdmin() };
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localDateDhaka(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(value);
}

async function audit(db: unknown, input: {
  tableName: string; rowId?: string | null; action: string; actorId: string;
  subjectUserId?: string | null; oldData?: unknown; newData?: unknown;
}) {
  const adminDb = db as { from: (table: string) => { insert: (value: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } };
  const { error } = await adminDb.from("attendance_audit_log").insert({
    table_name: input.tableName,
    row_id: input.rowId ?? null,
    action: ["clock_in", "break_start", "request_created", "task_created"].includes(input.action) ? "INSERT" : "UPDATE",
    actor_id: input.actorId,
    subject_user_id: input.subjectUserId ?? null,
    old_data: input.oldData ?? null,
    new_data: input.newData && typeof input.newData === "object" && !Array.isArray(input.newData)
      ? { ...(input.newData as Record<string, unknown>), _attendance_event: input.action }
      : { _attendance_event: input.action, value: input.newData ?? null },
  });
  if (error) console.error("Attendance audit log insert failed", error.message);
}

export const staffGetAttendanceWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const [settingsResult, sessionsResult, breaksResult, tasksResult, requestsResult] = await Promise.all([
      db.from("attendance_settings")
        .select("timezone, late_grace_minutes, early_clock_in_minutes, min_punch_gap_seconds, max_session_hours, allow_unscheduled_clock_in, geofence_enabled, qr_verification_enabled")
        .eq("id", true).maybeSingle(),
      db.from("attendance_sessions")
        .select("id, shift_id, duty_date, clock_in_at, clock_out_at, break_minutes, worked_minutes, late_minutes, status, verification_status")
        .eq("user_id", context.userId).order("clock_in_at", { ascending: false }).limit(30),
      db.from("attendance_breaks")
        .select("id, session_id, started_at, ended_at")
        .eq("user_id", context.userId).is("ended_at", null).order("started_at", { ascending: false }).limit(1),
      db.from("attendance_tasks")
        .select("id, title, description, due_date, due_at, priority, status, requires_verification, started_at, completed_at, completion_note, review_note")
        .eq("assigned_to", context.userId).order("due_date", { ascending: false }).limit(100),
      db.from("attendance_requests")
        .select("id, request_type, leave_type, leave_start_date, leave_end_date, target_date, reason, status, review_note, created_at")
        .eq("user_id", context.userId).order("created_at", { ascending: false }).limit(50),
    ]);
    if ([settingsResult, sessionsResult, breaksResult, tasksResult, requestsResult].some((r) => r.error)) {
      console.error("Attendance workspace read failed", [settingsResult.error, sessionsResult.error, breaksResult.error, tasksResult.error, requestsResult.error].filter(Boolean).map((e) => e?.message));
      throw new Error("Attendance workspace could not be loaded.");
    }
    const taskIds = (tasksResult.data ?? []).map((task: { id: string }) => task.id);
    const taskItemsResult = taskIds.length
      ? await db.from("attendance_task_items").select("id, task_id, label, sort_order, is_done, done_at").in("task_id", taskIds).order("sort_order")
      : { data: [], error: null };
    if (taskItemsResult.error) throw new Error("Task checklist could not be loaded.");
    const itemsByTask = new Map<string, unknown[]>();
    for (const item of taskItemsResult.data ?? []) {
      const current = itemsByTask.get(item.task_id) ?? [];
      current.push(item);
      itemsByTask.set(item.task_id, current);
    }
    const today = localDateDhaka();
    const todayShiftResult = await db.from("attendance_shifts")
      .select("id, shift_date, start_time, end_time, starts_at, ends_at, is_overnight, planned_break_minutes, station_id, duty_role, status")
      .eq("user_id", context.userId).eq("shift_date", today).neq("status", "cancelled").order("starts_at");
    if (todayShiftResult.error) throw new Error("Today's shift could not be loaded.");
    return {
      settings: settingsResult.data,
      today,
      shifts: todayShiftResult.data ?? [],
      activeBreak: breaksResult.data?.[0] ?? null,
      sessions: sessionsResult.data ?? [],
      tasks: (tasksResult.data ?? []).map((task: Record<string, unknown>) => ({ ...task, checklist: itemsByTask.get(String(task.id)) ?? [] })),
      requests: requestsResult.data ?? [],
    };
  });

export const staffClockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ shiftId: z.string().uuid().nullable().optional(), note: noteSchema, latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(), accuracyMeters: z.number().min(0).max(1000).optional(), qrToken: z.string().trim().min(32).max(512).optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: settings, error: settingsError } = await db.from("attendance_settings")
      .select("early_clock_in_minutes, late_grace_minutes, min_punch_gap_seconds, max_session_hours, allow_unscheduled_clock_in, geofence_enabled, qr_verification_enabled, attendance_alerts_enabled")
      .eq("id", true).maybeSingle();
    if (settingsError || !settings) throw new Error("Attendance settings are not available.");
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: active, error: activeError } = await db.from("attendance_sessions")
      .select("id").eq("user_id", context.userId).is("clock_out_at", null).limit(1);
    if (activeError) throw new Error("Could not check current duty status.");
    if (active?.length) throw new Error("You are already clocked in.");
    const { data: latest, error: latestError } = await db.from("attendance_sessions")
      .select("clock_in_at, clock_out_at").eq("user_id", context.userId)
      .order("clock_in_at", { ascending: false }).limit(1);
    if (latestError) throw new Error("Could not check the last punch.");
    if (latest?.[0]) {
      const latestAt = Date.parse(latest[0].clock_out_at ?? latest[0].clock_in_at);
      if (Number.isFinite(latestAt) && now.getTime() - latestAt < Number(settings.min_punch_gap_seconds) * 1000) {
        throw new Error("Please wait before punching again.");
      }
    }
    let shift: { id: string; shift_date: string; starts_at: string; ends_at: string; status: string; station_id?: string | null } | null = null;
    if (data.shiftId) {
      const { data: shiftRow, error } = await db.from("attendance_shifts")
        .select("id, shift_date, starts_at, ends_at, status, station_id").eq("id", data.shiftId)
        .eq("user_id", context.userId).maybeSingle();
      if (error || !shiftRow) throw new Error("The selected shift was not found.");
      if (shiftRow.status !== "scheduled") throw new Error("This shift is not available for clock-in.");
      if (Date.parse(nowIso) < Date.parse(shiftRow.starts_at) - Number(settings.early_clock_in_minutes) * 60000) {
        throw new Error("It is too early to clock in for this shift.");
      }
      if (Date.parse(nowIso) > Date.parse(shiftRow.ends_at)) throw new Error("This shift has already ended.");
      shift = shiftRow;
    } else if (!settings.allow_unscheduled_clock_in) {
      throw new Error("You must select a scheduled shift to clock in.");
    } else {
      const today = localDateDhaka(now);
      const { data: todaysShift, error } = await db.from("attendance_shifts")
        .select("id, shift_date, starts_at, ends_at, status, station_id").eq("user_id", context.userId)
        .eq("shift_date", today).eq("status", "scheduled").order("starts_at").limit(1);
      if (error) throw new Error("Could not check your schedule.");
      if (todaysShift?.[0] && Date.parse(nowIso) <= Date.parse(todaysShift[0].ends_at)) {
        if (Date.parse(nowIso) < Date.parse(todaysShift[0].starts_at) - Number(settings.early_clock_in_minutes) * 60000) {
          throw new Error("It is too early to clock in for today's shift.");
        }
        shift = todaysShift[0];
      }
    }
    if (settings.geofence_enabled) {
      if (data.latitude === undefined || data.longitude === undefined || data.accuracyMeters === undefined) {
        throw new Error("Location permission is required because the Owner enabled the attendance geofence.");
      }
      if (data.accuracyMeters > 50) {
        throw new Error("GPS accuracy is too low. Move to an open area and try again.");
      }
      if (!shift?.station_id) {
        throw new Error("A station-linked shift is required while geofence verification is enabled.");
      }
      const { data: station, error: stationError } = await db.from("attendance_stations")
        .select("latitude, longitude, geofence_radius_meters, is_active")
        .eq("id", shift.station_id).maybeSingle();
      if (stationError || !station || !station.is_active
        || station.latitude === null || station.latitude === undefined
        || station.longitude === null || station.longitude === undefined) {
        throw new Error("The selected shift's station has no active geofence configured.");
      }
      const distance = distanceMeters(data.latitude, data.longitude, Number(station.latitude), Number(station.longitude));
      if (!Number.isFinite(distance) || distance > Number(station.geofence_radius_meters)) {
        throw new Error("You are outside the permitted attendance geofence.");
      }
    }

    if (settings.qr_verification_enabled) {
      if (!data.qrToken) throw new Error("The Owner enabled QR verification. Scan a valid station QR before clocking in.");
      if (!shift?.station_id) throw new Error("QR verification requires a station-linked shift.");
      const tokenHash = createHash("sha256").update(data.qrToken, "utf8").digest("hex");
      // One conditional UPDATE provides atomic single-use semantics even when
      // two concurrent clock-in requests submit the same QR token. The server
      // already verified the authenticated staff identity above.
      const { data: consumed, error: qrError } = await db.from("attendance_qr_challenges")
        .update({ consumed_at: nowIso, consumed_by: context.userId })
        .eq("token_hash", tokenHash)
        .eq("station_id", shift.station_id)
        .is("consumed_at", null)
        .gt("expires_at", nowIso)
        .select("id, station_id")
        .maybeSingle();
      if (qrError || !consumed || consumed.station_id !== shift.station_id) {
        console.error("Attendance QR verification failed", qrError?.message ?? "Invalid station or consumed challenge");
        throw new Error("QR verification failed. Scan a fresh QR code for your assigned station.");
      }
    }

    const dutyDate = shift?.shift_date ?? localDateDhaka(now);
    const lateMinutes = shift ? Math.max(0, Math.floor((now.getTime() - Date.parse(shift.starts_at) - Number(settings.late_grace_minutes) * 60000) / 60000)) : 0;
    const { data: session, error: insertError } = await db.from("attendance_sessions").insert({
      user_id: context.userId, shift_id: shift?.id ?? null, duty_date: dutyDate,
      clock_in_at: nowIso, clock_in_source: "app", clock_in_note: data.note ?? null,
      late_minutes: lateMinutes, status: "open", verification_status: "unverified",
    }).select("id, user_id, shift_id, duty_date, clock_in_at, status, late_minutes").single();
    if (insertError || !session) {
      console.error("Attendance clock-in failed", insertError?.message);
      throw new Error("Clock-in failed. Please refresh and try again.");
    }
    await audit(db, { tableName: "attendance_sessions", rowId: session.id, action: "clock_in", actorId: context.userId, subjectUserId: context.userId, newData: session });
    if (lateMinutes > 0 && settings.attendance_alerts_enabled) {
      const { sendLateArrivalAlert } = await import("@/lib/attendance-push.server");
      await sendLateArrivalAlert({ sessionId: session.id, userId: context.userId, minutesLate: lateMinutes });
    }
    return { ok: true, session };
  });

export const staffClockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ note: noteSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const now = new Date();
    const { data: session, error: readError } = await db.from("attendance_sessions")
      .select("id, user_id, shift_id, clock_in_at, break_minutes, status")
      .eq("user_id", context.userId).is("clock_out_at", null).order("clock_in_at", { ascending: false }).limit(1).maybeSingle();
    if (readError || !session) throw new Error("No open attendance session was found.");
    const { data: openBreaks, error: breakReadError } = await db.from("attendance_breaks")
      .select("id, started_at").eq("session_id", session.id).is("ended_at", null).limit(1);
    if (breakReadError) throw new Error("Could not check your break status.");
    if (openBreaks?.length) throw new Error("End your active break before clocking out.");
    const { data: settings } = await db.from("attendance_settings").select("max_session_hours").eq("id", true).maybeSingle();
    const elapsed = now.getTime() - Date.parse(session.clock_in_at);
    if (elapsed <= 0 || elapsed > Number(settings?.max_session_hours ?? 16) * 60 * 60 * 1000) {
      throw new Error("Session duration is invalid; ask the Owner to review it.");
    }
    const workedMinutes = Math.max(0, Math.floor(elapsed / 60000) - Number(session.break_minutes ?? 0));
    const { data: shift } = session.shift_id
      ? await db.from("attendance_shifts").select("ends_at").eq("id", session.shift_id).maybeSingle()
      : { data: null };
    const earlyLeave = shift ? Math.max(0, Math.floor((Date.parse(shift.ends_at) - now.getTime()) / 60000)) : 0;
    const { error: updateError } = await db.from("attendance_sessions").update({
      clock_out_at: now.toISOString(), clock_out_source: "app", clock_out_note: data.note ?? null,
      worked_minutes: workedMinutes, early_leave_minutes: earlyLeave, status: "closed",
    }).eq("id", session.id).eq("user_id", context.userId).is("clock_out_at", null);
    if (updateError) {
      console.error("Attendance clock-out failed", updateError.message);
      throw new Error("Clock-out failed.");
    }
    await audit(db, { tableName: "attendance_sessions", rowId: session.id, action: "clock_out", actorId: context.userId, subjectUserId: context.userId, oldData: session, newData: { clockOutAt: now.toISOString(), workedMinutes } });
    return { ok: true, workedMinutes };
  });

export const staffStartBreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: session, error } = await db.from("attendance_sessions")
      .select("id").eq("user_id", context.userId).is("clock_out_at", null).order("clock_in_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !session) throw new Error("Clock in before starting a break.");
    const { data: openBreak } = await db.from("attendance_breaks").select("id")
      .eq("session_id", session.id).is("ended_at", null).limit(1).maybeSingle();
    if (openBreak) throw new Error("A break is already active.");
    const now = new Date().toISOString();
    const { data: created, error: insertError } = await db.from("attendance_breaks")
      .insert({ session_id: session.id, user_id: context.userId, started_at: now, source: "app" })
      .select("id, started_at").single();
    if (insertError || !created) throw new Error("Could not start break.");
    await audit(db, { tableName: "attendance_breaks", rowId: created.id, action: "break_start", actorId: context.userId, subjectUserId: context.userId, newData: created });
    return { ok: true, break: created };
  });

export const staffEndBreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: openBreak, error } = await db.from("attendance_breaks").select("id, session_id, started_at")
      .eq("user_id", context.userId).is("ended_at", null).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (error || !openBreak) throw new Error("No active break was found.");
    const endedAt = new Date().toISOString();
    const durationMinutes = Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(openBreak.started_at)) / 60000));
    const { error: updateError } = await db.from("attendance_breaks").update({ ended_at: endedAt }).eq("id", openBreak.id).is("ended_at", null);
    if (updateError) throw new Error("Could not end break.");
    const { data: session } = await db.from("attendance_sessions").select("break_minutes")
      .eq("id", openBreak.session_id).eq("user_id", context.userId).maybeSingle();
    const { error: sessionError } = await db.from("attendance_sessions")
      .update({ break_minutes: Number(session?.break_minutes ?? 0) + durationMinutes })
      .eq("id", openBreak.session_id).eq("user_id", context.userId).is("clock_out_at", null);
    if (sessionError) throw new Error("Break ended but attendance totals could not be updated; ask the Owner to review.");
    await audit(db, { tableName: "attendance_breaks", rowId: openBreak.id, action: "break_end", actorId: context.userId, subjectUserId: context.userId, oldData: openBreak, newData: { endedAt, durationMinutes } });
    return { ok: true, durationMinutes };
  });

export const staffCompleteAttendanceTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid(), completionNote: z.string().trim().max(1000).nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: task, error } = await db.from("attendance_tasks")
      .select("id, assigned_to, status, requires_verification").eq("id", data.taskId).eq("assigned_to", context.userId).maybeSingle();
    if (error || !task) throw new Error("Task not found.");
    if (["completed", "verified", "cancelled"].includes(task.status)) throw new Error("This task is already closed.");
    const now = new Date().toISOString();
    const nextStatus = "completed";
    const { error: updateError } = await db.from("attendance_tasks").update({
      status: nextStatus, completed_at: now, completion_note: data.completionNote ?? null,
    }).eq("id", task.id).eq("assigned_to", context.userId);
    if (updateError) throw new Error("Could not submit task completion.");
    await audit(db, { tableName: "attendance_tasks", rowId: task.id, action: "staff_completed", actorId: context.userId, subjectUserId: context.userId, oldData: task, newData: { status: nextStatus, completedAt: now } });
    return { ok: true, status: nextStatus };
  });

export const staffCreateAttendanceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    requestType: z.enum(["leave", "correction", "missed_punch", "overtime"]),
    sessionId: z.string().uuid().nullable().optional(),
    leaveType: z.string().trim().max(60).nullable().optional(),
    leaveStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    leaveEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    requestedClockIn: z.string().datetime().nullable().optional(),
    requestedClockOut: z.string().datetime().nullable().optional(),
    requestedOvertimeMinutes: z.number().int().min(1).max(960).nullable().optional(),
    reason: z.string().trim().min(5).max(1000),
  }).refine((v) => v.requestType !== "leave" || (v.leaveStartDate && v.leaveEndDate && v.leaveEndDate >= v.leaveStartDate), "Leave dates are required and must be valid.").refine((v) => v.requestType !== "correction" || Boolean(v.sessionId && (v.requestedClockIn || v.requestedClockOut)), "Correction requires a session and a requested time.").refine((v) => v.requestType !== "missed_punch" || Boolean(v.targetDate && v.requestedClockIn && v.requestedClockOut), "Missed punch requires a date and both times.").refine((v) => v.requestType !== "overtime" || Boolean(v.sessionId && v.requestedOvertimeMinutes), "Overtime requires a session and minutes.").parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: request, error } = await db.from("attendance_requests").insert({
      user_id: context.userId, request_type: data.requestType, session_id: data.sessionId ?? null, leave_type: data.leaveType ?? null,
      leave_start_date: data.leaveStartDate ?? null, leave_end_date: data.leaveEndDate ?? null,
      target_date: data.targetDate ?? null, requested_clock_in: data.requestedClockIn ?? null,
      requested_clock_out: data.requestedClockOut ?? null, requested_overtime_minutes: data.requestedOvertimeMinutes ?? null,
      reason: data.reason,
    }).select("id, request_type, status, created_at").single();
    if (error || !request) throw new Error("Could not submit attendance request.");
    await audit(db, { tableName: "attendance_requests", rowId: request.id, action: "request_created", actorId: context.userId, subjectUserId: context.userId, newData: request });
    const { data: notificationSettings, error: notificationSettingsError } = await db.from("attendance_settings")
      .select("attendance_alerts_enabled").eq("id", true).maybeSingle();
    if (notificationSettingsError) console.error("Attendance alert setting lookup failed", notificationSettingsError.message);
    if (notificationSettings?.attendance_alerts_enabled) {
      const { sendPendingRequestAlert } = await import("@/lib/attendance-push.server");
      await sendPendingRequestAlert({ requestId: request.id, userId: context.userId, requestType: request.request_type });
    }
    return { ok: true, request };
  });

export const ownerListAttendanceRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can review attendance requests.");
    const { data, error } = await db.from("attendance_requests")
      .select("id, user_id, request_type, leave_type, leave_start_date, leave_end_date, target_date, requested_clock_in, requested_clock_out, requested_overtime_minutes, reason, status, review_note, created_at")
      .order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error("Could not load attendance requests.");
    const ids = Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)));
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const names = new Map((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name || "Unnamed staff"]));
    return (data ?? []).map((r: Record<string, unknown>) => ({ ...r, staff_name: names.get(String(r.user_id)) ?? "Staff member" }));
  });

export const ownerReviewAttendanceRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ requestId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), reviewNote: z.string().trim().max(1000).nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can review attendance requests.");
    const { data: current, error: readError } = await db.from("attendance_requests")
      .select("id, user_id, request_type, status").eq("id", data.requestId).maybeSingle();
    if (readError || !current) throw new Error("Attendance request not found.");
    if (current.status !== "pending") throw new Error("This request has already been reviewed.");
    const now = new Date().toISOString();
    const { data: updated, error } = await db.from("attendance_requests").update({
      status: data.decision, reviewed_by: context.userId, reviewed_at: now, review_note: data.reviewNote ?? null,
    }).eq("id", current.id).eq("status", "pending").select("id").maybeSingle();
    if (error) throw new Error("Could not review attendance request.");
    if (!updated) throw new Error("This request has already been reviewed.");
    await audit(db, { tableName: "attendance_requests", rowId: current.id, action: data.decision, actorId: context.userId, subjectUserId: current.user_id, oldData: current, newData: { status: data.decision, reviewedAt: now, reviewNote: data.reviewNote ?? null } });
    const { data: notificationSettings, error: notificationSettingsError } = await db.from("attendance_settings")
      .select("attendance_alerts_enabled").eq("id", true).maybeSingle();
    if (notificationSettingsError) console.error("Attendance alert setting lookup failed", notificationSettingsError.message);
    if (notificationSettings?.attendance_alerts_enabled) {
      const { sendRequestDecisionAlert } = await import("@/lib/attendance-push.server");
      await sendRequestDecisionAlert({
        requestId: current.id,
        userId: current.user_id,
        requestType: current.request_type,
        approved: data.decision === "approved",
        note: data.reviewNote ?? null,
      });
    }
    return { ok: true };
  });

export const ownerCreateAttendanceTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    assignedTo: z.string().uuid(), shiftId: z.string().uuid().nullable().optional(), stationId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dueAt: z.string().datetime().nullable().optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]), requiresVerification: z.boolean().default(true),
    items: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can assign attendance tasks.");
    const { data: role, error: roleError } = await db.from("user_roles").select("user_id").eq("user_id", data.assignedTo).eq("role", "staff").maybeSingle();
    if (roleError || !role) throw new Error("Choose an existing staff account.");
    if (data.stationId) {
      const { data: station } = await db.from("attendance_stations").select("id").eq("id", data.stationId).eq("is_active", true).maybeSingle();
      if (!station) throw new Error("Choose an active station.");
    }
    const { data: task, error } = await db.from("attendance_tasks").insert({
      assigned_to: data.assignedTo, assigned_by: context.userId, shift_id: data.shiftId ?? null,
      station_id: data.stationId ?? null, title: data.title, description: data.description ?? null,
      due_date: data.dueDate, due_at: data.dueAt ?? null, priority: data.priority,
      requires_verification: data.requiresVerification, status: "pending",
    }).select("id, assigned_to, title, due_date, status").single();
    if (error || !task) throw new Error("Could not create attendance task.");
    if (data.items.length) {
      const { error: itemsError } = await db.from("attendance_task_items").insert(data.items.map((label, sort_order) => ({ task_id: task.id, label, sort_order })));
      if (itemsError) {
        console.error("Task created but checklist insert failed", itemsError.message);
        throw new Error("Task was created, but checklist items could not be saved. Open the task and contact the Owner.");
      }
    }
    await audit(db, { tableName: "attendance_tasks", rowId: task.id, action: "task_created", actorId: context.userId, subjectUserId: data.assignedTo, newData: task });
    return { ok: true, task };
  });

export const ownerReviewAttendanceTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ taskId: z.string().uuid(), decision: z.enum(["verified", "rejected"]), reviewNote: z.string().trim().max(1000).nullable().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can verify attendance tasks.");
    const { data: task, error: readError } = await db.from("attendance_tasks").select("id, assigned_to, status").eq("id", data.taskId).maybeSingle();
    if (readError || !task) throw new Error("Task not found.");
    if (!["awaiting_verification", "completed"].includes(task.status)) throw new Error("Task is not awaiting verification.");
    const now = new Date().toISOString();
    const nextStatus = data.decision;
    const { error } = await db.from("attendance_tasks").update({
      status: nextStatus, verified_by: data.decision === "verified" ? context.userId : null,
      verified_at: data.decision === "verified" ? now : null, review_note: data.reviewNote ?? null,
    }).eq("id", task.id).in("status", ["awaiting_verification", "completed"]);
    if (error) throw new Error("Could not review task.");
    await audit(db, { tableName: "attendance_tasks", rowId: task.id, action: data.decision, actorId: context.userId, subjectUserId: task.assigned_to, oldData: task, newData: { status: nextStatus, reviewNote: data.reviewNote ?? null } });
    return { ok: true, status: nextStatus };
  });

export const staffToggleAttendanceTaskItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ itemId: z.string().uuid(), isDone: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { access, db } = await dbForUser(context.userId);
    if (!access.isStaff) throw new Error("Only staff accounts can use the staff attendance workspace.");
    const { data: item, error: readError } = await db.from("attendance_task_items")
      .select("id, task_id, label, is_done").eq("id", data.itemId).maybeSingle();
    if (readError || !item) throw new Error("Checklist item not found.");
    const { data: task, error: taskError } = await db.from("attendance_tasks")
      .select("id, assigned_to, status").eq("id", item.task_id).eq("assigned_to", context.userId).maybeSingle();
    if (taskError || !task) throw new Error("This checklist does not belong to you.");
    if (["completed", "verified", "cancelled"].includes(task.status)) throw new Error("This task is already closed.");
    const now = new Date().toISOString();
    const { error } = await db.from("attendance_task_items").update({
      is_done: data.isDone, done_at: data.isDone ? now : null, done_by: data.isDone ? context.userId : null,
    }).eq("id", item.id);
    if (error) throw new Error("Could not update checklist item.");
    await audit(db, { tableName: "attendance_task_items", rowId: item.id, action: data.isDone ? "checklist_item_done" : "checklist_item_reopened", actorId: context.userId, subjectUserId: context.userId, oldData: item, newData: { is_done: data.isDone, done_at: data.isDone ? now : null } });
    return { ok: true };
  });
