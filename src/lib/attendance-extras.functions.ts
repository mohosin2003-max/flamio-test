import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  STORE_CHECKLISTS, buildReport, expandWeeklyDates, missedClockOuts, overlaps, overlongBreaks,
  retentionEligibleSessions, rollingCutoff, shiftWindow, validatePlannedBreak, type ReportPeriod,
} from "@/lib/attendance-rules";

/**
 * Owner-only attendance extensions: recurring shifts, reports, issue
 * detection, store checklists, feature toggles and retention.
 * Every handler re-checks Owner rights on the server.
 */
async function ownerDb(userId: string) {
  const { getAccessProfile } = await import("@/lib/owner.server");
  const access = await getAccessProfile(userId);
  if (!access.isOwner) throw new Error("Only the Owner can use this attendance tool.");
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return untypedAdmin();
}

async function auditOwner(db: Awaited<ReturnType<typeof ownerDb>>, actorId: string, event: string, data: Record<string, unknown>, subjectUserId: string | null = null) {
  const { error } = await db.from("attendance_audit_log").insert({
    table_name: "attendance_owner_actions", row_id: null, action: "INSERT", actor_id: actorId,
    subject_user_id: subjectUserId, old_data: null, new_data: { ...data, _attendance_event: event },
  });
  if (error) console.error("Attendance owner audit failed", error.message);
}

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeKey = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/* --------------------------- Recurring shifts --------------------------- */

export const ownerCreateRecurringShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    userId: z.string().uuid(), stationId: z.string().uuid().nullable().optional(),
    dutyRole: z.string().trim().max(80).nullable().optional(),
    fromDate: dateKey, toDate: dateKey, weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startTime: timeKey, endTime: timeKey, plannedBreakMinutes: z.number().int().min(0).max(240).default(0),
    preview: z.boolean().default(false),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const dates = expandWeeklyDates(data.fromDate, data.toDate, data.weekdays);
    const windows = dates.map((d) => ({ date: d, ...shiftWindow(d, data.startTime, data.endTime) }));
    for (const w of windows) validatePlannedBreak(w.startAt, w.endAt, data.plannedBreakMinutes);
    const { data: role } = await db.from("user_roles").select("user_id").eq("user_id", data.userId).eq("role", "staff").maybeSingle();
    if (!role) throw new Error("Choose an existing staff account.");
    if (data.stationId) {
      const { data: st } = await db.from("attendance_stations").select("id").eq("id", data.stationId).eq("is_active", true).maybeSingle();
      if (!st) throw new Error("Choose an active station.");
    }
    const first = windows[0]!;
    const last = windows[windows.length - 1]!;
    const { data: existing, error } = await db.from("attendance_shifts").select("starts_at, ends_at")
      .eq("user_id", data.userId).eq("status", "scheduled").lt("starts_at", last.endAt).gt("ends_at", first.startAt);
    if (error) throw new Error("Could not verify schedule overlap; no shifts were created.");
    const taken = (existing ?? []).map((e: { starts_at: string; ends_at: string }) => ({ startAt: e.starts_at, endAt: e.ends_at }));
    const fresh = windows.filter((w) => !taken.some((t: { startAt: string; endAt: string }) => overlaps(w, t)));
    const skipped = windows.length - fresh.length;
    if (data.preview) {
      return { preview: true as const, created: 0, skippedOverlaps: skipped,
        items: windows.map((w) => ({ date: w.date, startAt: w.startAt, endAt: w.endAt, overnight: w.overnight, conflict: !fresh.includes(w) })) };
    }
    if (fresh.length) {
      const { error: insertError } = await db.from("attendance_shifts").insert(fresh.map((w) => ({
        user_id: data.userId, station_id: data.stationId ?? null, duty_role: data.dutyRole ?? null,
        shift_date: w.date, start_time: data.startTime, end_time: data.endTime, starts_at: w.startAt, ends_at: w.endAt,
        is_overnight: w.overnight, planned_break_minutes: data.plannedBreakMinutes, created_by: context.userId,
      })));
      if (insertError) { console.error("Recurring shift insert failed", insertError.message); throw new Error("Could not create the recurring shifts."); }
    }
    await auditOwner(db, context.userId, "recurring_shifts_created", { from: data.fromDate, to: data.toDate, weekdays: data.weekdays, created: fresh.length, skipped }, data.userId);
    return { preview: false as const, created: fresh.length, skippedOverlaps: skipped, items: [] as { date: string; startAt: string; endAt: string; overnight: boolean; conflict: boolean }[] };
  });

/* -------------------------------- Reports ------------------------------- */

export const ownerGetAttendanceReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ fromDate: dateKey, toDate: dateKey, period: z.enum(["daily", "weekly", "monthly"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    if (data.toDate < data.fromDate) throw new Error("End date must be on or after the start date.");
    const { data: sessions, error } = await db.from("attendance_sessions")
      .select("user_id, shift_id, duty_date, worked_minutes, break_minutes, late_minutes, overtime_minutes, clock_out_at")
      .gte("duty_date", data.fromDate).lte("duty_date", data.toDate).limit(5000);
    if (error) throw new Error("Attendance report could not be loaded.");
    const rows = sessions ?? [];
    const userIds = [...new Set(rows.map((r: { user_id: string }) => r.user_id))];
    const shiftIds = [...new Set(rows.map((r: { shift_id: string | null }) => r.shift_id).filter(Boolean))];
    const [profiles, shifts] = await Promise.all([
      userIds.length ? db.from("profiles").select("id, full_name").in("id", userIds) : Promise.resolve({ data: [] }),
      shiftIds.length ? db.from("attendance_shifts").select("id, starts_at, ends_at, planned_break_minutes").in("id", shiftIds) : Promise.resolve({ data: [] }),
    ]);
    const names = new Map((profiles.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name?.trim() || "Unnamed staff"]));
    const scheduled = new Map((shifts.data ?? []).map((s: { id: string; starts_at: string; ends_at: string; planned_break_minutes: number }) => [
      s.id, Math.max(0, Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000) - Number(s.planned_break_minutes ?? 0)),
    ]));
    const report = buildReport(rows.map((r: Record<string, unknown>) => ({
      userId: String(r.user_id), staffName: names.get(String(r.user_id)) ?? "Staff member", dutyDate: String(r.duty_date),
      workedMinutes: Number(r.worked_minutes ?? 0), breakMinutes: Number(r.break_minutes ?? 0), lateMinutes: Number(r.late_minutes ?? 0),
      overtimeMinutes: Number(r.overtime_minutes ?? 0), scheduledMinutes: r.shift_id ? scheduled.get(String(r.shift_id)) ?? null : null,
      closed: Boolean(r.clock_out_at),
    })), data.period as ReportPeriod);
    return { rows: report, truncated: rows.length >= 5000 };
  });

/* ---------------------------- Issue detection --------------------------- */

export const ownerCheckAttendanceIssues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sendAlerts: z.boolean().default(false) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const now = Date.now();
    const [breaksRes, sessionsRes, settingsRes] = await Promise.all([
      db.from("attendance_breaks").select("id, user_id, session_id, started_at").is("ended_at", null).limit(500),
      db.from("attendance_sessions").select("id, user_id, clock_in_at, shift_id").is("clock_out_at", null).limit(500),
      db.from("attendance_settings").select("max_session_hours, attendance_alerts_enabled").eq("id", true).maybeSingle(),
    ]);
    if (breaksRes.error || sessionsRes.error) throw new Error("Attendance issues could not be checked.");
    const shiftIds = (sessionsRes.data ?? []).map((s: { shift_id: string | null }) => s.shift_id).filter(Boolean);
    const { data: shifts } = shiftIds.length ? await db.from("attendance_shifts").select("id, ends_at, planned_break_minutes").in("id", shiftIds) : { data: [] };
    const ends = new Map((shifts ?? []).map((s: { id: string; ends_at: string }) => [s.id, s.ends_at]));
    const plannedByShift = new Map((shifts ?? []).map((s: { id: string; planned_break_minutes: number | null }) => [s.id, s.planned_break_minutes]));
    const shiftBySession = new Map((sessionsRes.data ?? []).map((s: { id: string; shift_id: string | null }) => [s.id, s.shift_id]));
    const longBreaks = overlongBreaks((breaksRes.data ?? []).map((b: { id: string; user_id: string; session_id: string; started_at: string }) => {
      const shiftId = shiftBySession.get(b.session_id) ?? null;
      return { id: b.id, userId: b.user_id, startedAt: b.started_at, scheduledAllowanceMinutes: shiftId ? Number(plannedByShift.get(shiftId) ?? 0) : null };
    }), now);
    const missed = missedClockOuts((sessionsRes.data ?? []).map((s: { id: string; user_id: string; clock_in_at: string; shift_id: string | null }) => ({
      id: s.id, userId: s.user_id, clockInAt: s.clock_in_at, shiftEndsAt: s.shift_id ? ends.get(s.shift_id) ?? null : null,
    })), now, 30, Number(settingsRes.data?.max_session_hours ?? 16));
    const ids = [...new Set([...longBreaks.map((b) => b.userId), ...missed.map((m) => m.userId)])];
    const { data: profiles } = ids.length ? await db.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const names = new Map((profiles ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name?.trim() || "Unnamed staff"]));
    let alertsQueued = 0;
    const alertsAllowed = data.sendAlerts && Boolean(settingsRes.data?.attendance_alerts_enabled);
    if (alertsAllowed) {
      const { sendAttendanceIssueAlert } = await import("@/lib/attendance-push.server");
      for (const b of longBreaks) if (await sendAttendanceIssueAlert({ kind: "overlong_break", recordId: b.id, userId: b.userId, minutes: b.minutes })) alertsQueued++;
      for (const m of missed) if (await sendAttendanceIssueAlert({ kind: "missed_clock_out", recordId: m.id, userId: m.userId, minutes: 0 })) alertsQueued++;
    }
    return {
      overlongBreaks: longBreaks.map((b) => ({ id: b.id, staffName: names.get(b.userId) ?? "Staff member", minutes: b.minutes, startedAt: b.startedAt, kind: b.kind, limitMinutes: b.limitMinutes, overBy: b.overBy })),
      missedClockOuts: missed.map((m) => ({ id: m.id, staffName: names.get(m.userId) ?? "Staff member", clockInAt: m.clockInAt, shiftEndsAt: m.shiftEndsAt })),
      alertsRequested: data.sendAlerts, alertsEnabled: Boolean(settingsRes.data?.attendance_alerts_enabled), alertsQueued,
    };
  });

/** Recover one stale session via the existing DB RPC (caps at max session, flags for review). */
export const ownerRecoverStaleSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const { data: session } = await db.from("attendance_sessions").select("id, user_id, clock_out_at").eq("id", data.sessionId).maybeSingle();
    if (!session || session.clock_out_at) throw new Error("This session is not open.");
    const { data: settings } = await db.from("attendance_settings").select("max_session_hours").eq("id", true).maybeSingle();
    const { data: result, error } = await db.rpc("attendance_auto_close_stale_session", { _user_id: session.user_id, _max_session_hours: Number(settings?.max_session_hours ?? 16) });
    if (error) { console.error("Stale recovery failed", error.message); throw new Error("Session could not be recovered; it may not have exceeded the maximum length yet."); }
    await auditOwner(db, context.userId, "stale_session_recovery_requested", { sessionId: data.sessionId, result: result ?? null }, session.user_id);
    return { recovered: Boolean(result) };
  });

/* ---------------------------- Store checklists -------------------------- */

export const ownerAssignStoreChecklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ kind: z.enum(["opening", "closing"]), assignedTo: z.string().uuid(), dueDate: dateKey }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const { requireTasksFeature } = await import("@/lib/attendance-features.server");
    await requireTasksFeature(db);
    const { data: role } = await db.from("user_roles").select("user_id").eq("user_id", data.assignedTo).eq("role", "staff").maybeSingle();
    if (!role) throw new Error("Choose an existing staff account.");
    const template = STORE_CHECKLISTS[data.kind];
    const title = `${template.title} — ${data.dueDate}`;
    const { data: dup } = await db.from("attendance_tasks").select("id").eq("title", title).neq("status", "cancelled").limit(1);
    if (dup?.length) throw new Error("This checklist is already assigned for that date.");
    const { data: task, error } = await db.from("attendance_tasks").insert({
      assigned_to: data.assignedTo, assigned_by: context.userId, title, description: `Store ${data.kind} procedure. Each item records who ticked it and the server time.`,
      due_date: data.dueDate, priority: "urgent", requires_verification: true, status: "pending",
    }).select("id").single();
    if (error || !task) throw new Error("Could not assign the checklist.");
    const { error: itemsError } = await db.from("attendance_task_items").insert(template.items.map((label, sort_order) => ({ task_id: task.id, label, sort_order })));
    if (itemsError) throw new Error("Checklist created but items failed to save; cancel it and try again.");
    await auditOwner(db, context.userId, `store_${data.kind}_checklist_assigned`, { taskId: task.id, dueDate: data.dueDate }, data.assignedTo);
    return { taskId: task.id };
  });

export const ownerListStoreChecklists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await ownerDb(context.userId);
    const { data: tasks, error } = await db.from("attendance_tasks")
      .select("id, assigned_to, title, due_date, status, completed_at, verified_at, review_note")
      .like("title", "Store %checklist —%").order("due_date", { ascending: false }).limit(30);
    if (error) throw new Error("Checklists could not be loaded.");
    const ids = (tasks ?? []).map((t: { id: string }) => t.id);
    const staffIds = [...new Set((tasks ?? []).map((t: { assigned_to: string }) => t.assigned_to))];
    const [items, profiles] = await Promise.all([
      ids.length ? db.from("attendance_task_items").select("task_id, label, is_done, done_at, done_by, sort_order").in("task_id", ids).order("sort_order") : Promise.resolve({ data: [] }),
      staffIds.length ? db.from("profiles").select("id, full_name").in("id", staffIds) : Promise.resolve({ data: [] }),
    ]);
    const names = new Map((profiles.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name?.trim() || "Unnamed staff"]));
    return (tasks ?? []).map((t: Record<string, unknown>) => ({
      id: String(t.id), title: String(t.title), dueDate: String(t.due_date), status: String(t.status),
      staffName: names.get(String(t.assigned_to)) ?? "Staff member",
      completedAt: t.completed_at ? String(t.completed_at) : null, verifiedAt: t.verified_at ? String(t.verified_at) : null,
      items: (items.data ?? []).filter((i: { task_id: string }) => i.task_id === t.id).map((i: { label: string; is_done: boolean; done_at: string | null; done_by: string | null }) => ({
        label: i.label, isDone: i.is_done, doneAt: i.done_at, doneBy: i.done_by ? names.get(i.done_by) ?? "Staff member" : null,
      })),
    }));
  });

/* ---------------------------- Feature toggles --------------------------- */

export const ownerGetAttendanceFeatures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await ownerDb(context.userId);
    const { loadFeatureToggles } = await import("@/lib/attendance-features.server");
    return loadFeatureToggles(db);
  });

export const ownerSetAttendanceFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ attendanceEnabled: z.boolean(), tasksEnabled: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const { loadFeatureToggles } = await import("@/lib/attendance-features.server");
    const before = await loadFeatureToggles(db);
    if (!before.columnsPresent) throw new Error("The on/off switches need a database update that has not been applied to TEST yet.");
    const { error } = await db.from("attendance_settings").update({ attendance_enabled: data.attendanceEnabled, tasks_enabled: data.tasksEnabled, updated_by: context.userId }).eq("id", true);
    if (error) throw new Error("Could not save the switches.");
    await auditOwner(db, context.userId, "feature_toggles_updated", { before, after: data });
    return { ok: true };
  });

/* ------------------------------- Retention ------------------------------ */

async function retentionCandidates(db: Awaited<ReturnType<typeof ownerDb>>, days: number) {
  const cutoff = rollingCutoff(new Date(), days);
  const base = "id, clock_out_at, status, verification_status";
  // The selfie column may not exist yet in TEST; fall back without it (then no selfie files can exist).
  let res = await db.from("attendance_sessions").select(`${base}, clock_in_selfie_path`).lt("clock_out_at", cutoff.toISOString()).limit(1000);
  if (res.error && /clock_in_selfie_path/.test(res.error.message)) {
    res = await db.from("attendance_sessions").select(base).lt("clock_out_at", cutoff.toISOString()).limit(1000);
  }
  const { data, error } = res;
  if (error) throw new Error("Retention preview could not be loaded.");
  const rows = (data ?? []).map((r: { id: string; clock_out_at: string | null; status: string; verification_status: string; clock_in_selfie_path?: string | null }) => ({
    id: r.id, clockOutAt: r.clock_out_at, status: r.status, verificationStatus: r.verification_status, selfiePath: r.clock_in_selfie_path ?? null,
  }));
  const ids = rows.map((r: { id: string }) => r.id);
  // Sessions referenced by a pending request stay until the request is reviewed.
  const { data: pending } = ids.length ? await db.from("attendance_requests").select("session_id").eq("status", "pending").in("session_id", ids) : { data: [] };
  const blocked = new Set((pending ?? []).map((p: { session_id: string }) => p.session_id));
  const eligible = retentionEligibleSessions(rows, cutoff).filter((r) => !blocked.has(r.id));
  return { cutoff, eligible, protectedCount: rows.length - eligible.length };
}

export const ownerPreviewAttendanceRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await ownerDb(context.userId);
    const { data: settings } = await db.from("attendance_settings").select("retention_days").eq("id", true).maybeSingle();
    const days = Math.max(30, Number(settings?.retention_days ?? 30));
    const r = await retentionCandidates(db, days);
    return { days, cutoff: r.cutoff.toISOString(), eligibleSessions: r.eligible.length, protectedSessions: r.protectedCount };
  });

export const ownerRunAttendanceRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ confirm: z.literal("DELETE"), expectedCount: z.number().int().min(0) }).parse(input))
  .handler(async ({ data, context }) => {
    const db = await ownerDb(context.userId);
    const { data: settings } = await db.from("attendance_settings").select("retention_days").eq("id", true).maybeSingle();
    const days = Math.max(30, Number(settings?.retention_days ?? 30));
    const r = await retentionCandidates(db, days);
    if (r.eligible.length !== data.expectedCount) throw new Error("The records changed since your preview. Refresh the preview and try again.");
    if (!r.eligible.length) return { deletedSessions: 0, removedSelfieFiles: 0, storageFailedSessions: 0, databaseFailedSessions: 0, partial: false };
    const { purgeRetention } = await import("@/lib/attendance-retention");
    const { SELFIE_BUCKET } = await import("@/lib/attendance-selfie");
    const result = await purgeRetention(r.eligible.map((e) => ({ id: e.id, selfiePath: (e as { selfiePath?: string | null }).selfiePath ?? null })), {
      async removeFiles(paths) {
        const { error } = await db.storage.from(SELFIE_BUCKET).remove(paths);
        return { error: error ? String(error.message ?? error) : null };
      },
      async deleteBreaks(ids) {
        const { error } = await db.from("attendance_breaks").delete().in("session_id", ids);
        return { error: error ? error.message : null };
      },
      async deleteSessions(ids) {
        const { data: gone, error } = await db.from("attendance_sessions").delete().in("id", ids).not("clock_out_at", "is", null).select("id");
        return { deletedIds: (gone ?? []).map((g: { id: string }) => g.id), error: error ? error.message : null };
      },
    });
    await auditOwner(db, context.userId, "retention_purge", {
      days, cutoff: r.cutoff.toISOString(), deletedSessions: result.deletedSessions, removedSelfieFiles: result.removedSelfieFiles,
      storageFailedSessions: result.storageFailedSessions.length, databaseFailedSessions: result.databaseFailedSessions.length,
    });
    return {
      deletedSessions: result.deletedSessions, removedSelfieFiles: result.removedSelfieFiles,
      storageFailedSessions: result.storageFailedSessions.length, databaseFailedSessions: result.databaseFailedSessions.length, partial: result.partial,
    };
  });
