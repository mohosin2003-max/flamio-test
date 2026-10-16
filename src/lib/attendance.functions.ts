import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  AttendanceRpc,
  AttendanceRpcName,
} from "@/integrations/supabase/attendance.types";

/**
 * FLAMIO ATTENDANCE MASTER — server functions.
 *
 * Every call runs with the signed-in user's own token (RLS + SECURITY DEFINER
 * RPCs that read auth.uid()). No admin client is used and no user ID is ever
 * accepted from the browser for self-service actions. Manager actions are
 * pre-checked with attendance_is_manager(<caller>) and fail closed; the
 * database functions re-check the same rule themselves.
 *
 * Deliberately NOT exposed: claim_owner, internal helpers, run_maintenance.
 */

type Ctx = { supabase: unknown; userId: string };

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

async function callRpc<N extends AttendanceRpcName>(
  ctx: Ctx,
  fn: N,
  args: AttendanceRpc[N]["Args"],
): Promise<AttendanceRpc[N]["Returns"]> {
  const { data, error } = await (ctx.supabase as RpcClient).rpc(fn, args as Record<string, unknown>);
  if (error) {
    console.error(`[attendance] ${fn} failed:`, error.message);
    throw new Error(error.message);
  }
  return data as AttendanceRpc[N]["Returns"];
}

async function assertMember(ctx: Ctx) {
  const ok = await callRpc(ctx, "attendance_is_member", { _user_id: ctx.userId }).catch(() => false);
  if (ok !== true) throw new Error("Forbidden: not an attendance team member");
}

async function assertManager(ctx: Ctx) {
  const ok = await callRpc(ctx, "attendance_is_manager", { _user_id: ctx.userId }).catch(() => false);
  if (ok !== true) throw new Error("Forbidden: manager access required");
}

const uuid = z.string().uuid();
const note = z.string().trim().max(1000).nullish();
const isoTs = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const punchSource = z.enum(["app", "kiosk"]).optional();

/* ----------------------------- Self-service ----------------------------- */

export const attendanceMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const [isMember, isManager] = await Promise.all([
      callRpc(context, "attendance_is_member", { _user_id: context.userId }).catch(() => false),
      callRpc(context, "attendance_is_manager", { _user_id: context.userId }).catch(() => false),
    ]);
    return { isMember: isMember === true, isManager: isManager === true };
  });

export const attendanceClockIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ note, source: punchSource }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_clock_in", { _note: data.note ?? null, _source: data.source ?? "app" });
  });

export const attendanceClockOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ note, source: punchSource }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_clock_out", { _note: data.note ?? null, _source: data.source ?? "app" });
  });

export const attendanceStartBreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_start_break", {});
  });

export const attendanceEndBreak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_end_break", {});
  });

export const attendanceUpdateTaskProgress = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ taskId: uuid, status: z.enum(["in_progress", "completed"]), note }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_update_task_progress", {
      _task_id: data.taskId,
      _status: data.status,
      _note: data.note ?? null,
    });
  });

export const attendanceToggleTaskItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ itemId: uuid, done: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_toggle_task_item", { _item_id: data.itemId, _done: data.done });
  });

const requestSchema = z.object({
  requestType: z.enum(["leave", "missed_punch", "correction", "overtime"]),
  reason: z.string().trim().min(3).max(1000),
  leaveType: z.enum(["casual", "sick", "annual", "unpaid", "emergency", "other"]).nullish(),
  leaveStartDate: isoDate.nullish(),
  leaveEndDate: isoDate.nullish(),
  sessionId: uuid.nullish(),
  targetDate: isoDate.nullish(),
  requestedClockIn: isoTs.nullish(),
  requestedClockOut: isoTs.nullish(),
  requestedOvertimeMinutes: z.number().int().min(1).max(24 * 60).nullish(),
});

export const attendanceSubmitRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => requestSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_submit_request", {
      _request_type: data.requestType,
      _reason: data.reason,
      _leave_type: data.leaveType ?? null,
      _leave_start_date: data.leaveStartDate ?? null,
      _leave_end_date: data.leaveEndDate ?? null,
      _session_id: data.sessionId ?? null,
      _target_date: data.targetDate ?? null,
      _requested_clock_in: data.requestedClockIn ?? null,
      _requested_clock_out: data.requestedClockOut ?? null,
      _requested_overtime_minutes: data.requestedOvertimeMinutes ?? null,
    });
  });

export const attendanceCancelRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMember(context);
    return callRpc(context, "attendance_cancel_request", { _request_id: data.requestId });
  });

/* ------------------------------ Manager only ----------------------------- */

export const attendanceReviewTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: uuid, approve: z.boolean(), note }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return callRpc(context, "attendance_review_task", {
      _task_id: data.taskId,
      _approve: data.approve,
      _note: data.note ?? null,
    });
  });

export const attendanceReviewRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requestId: uuid, approve: z.boolean(), note }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return callRpc(context, "attendance_review_request", {
      _request_id: data.requestId,
      _approve: data.approve,
      _note: data.note ?? null,
    });
  });

export const attendanceVerifySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ sessionId: uuid, status: z.enum(["unverified", "verified", "disputed"]), note })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return callRpc(context, "attendance_verify_session", {
      _session_id: data.sessionId,
      _status: data.status,
      _note: data.note ?? null,
    });
  });

export const attendanceCorrectSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ sessionId: uuid, clockInAt: isoTs, clockOutAt: isoTs, reason: z.string().trim().min(3).max(1000) })
      .refine((v) => Date.parse(v.clockOutAt) > Date.parse(v.clockInAt), "Clock-out must be after clock-in")
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return callRpc(context, "attendance_manager_correct_session", {
      _session_id: data.sessionId,
      _clock_in_at: data.clockInAt,
      _clock_out_at: data.clockOutAt,
      _reason: data.reason,
    });
  });

export const attendanceTeamDirectory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context);
    const team = await callRpc(context, "attendance_team_directory", {});
    // Phones are never sent to the browser.
    return (team ?? []).map((m) => ({ user_id: m.user_id, full_name: m.full_name, roles: m.roles }));
  });

/* ------------------------- Reads (RLS-scoped) ---------------------------- */

type QB = {
  select: (cols: string) => QB;
  eq: (c: string, v: unknown) => QB;
  in: (c: string, v: unknown[]) => QB;
  is: (c: string, v: null) => QB;
  gte: (c: string, v: unknown) => QB;
  lte: (c: string, v: unknown) => QB;
  order: (c: string, o?: { ascending?: boolean }) => QB;
  limit: (n: number) => QB;
  insert: (v: unknown) => QB;
  update: (v: unknown) => QB;
  single: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  then: PromiseLike<{ data: unknown; error: { message: string } | null }>["then"];
};
const db = (ctx: Ctx, table: string) =>
  (ctx.supabase as { from: (t: string) => QB }).from(table);

async function rows<T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    console.error("[attendance] read failed:", error.message);
    throw new Error("Couldn't load attendance data");
  }
  return (data ?? []) as T[];
}

async function assertOwner(ctx: Ctx) {
  const { data } = await (ctx.supabase as RpcClient).rpc("has_role", { _user_id: ctx.userId, _role: "owner" });
  if (data !== true) throw new Error("Forbidden: owner access required");
}

/** Staff's own data only — user_id is always the caller, never client input. */
export const attendanceMyOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMember(context);
    const me = context.userId;
    const since = new Date(Date.now() - 31 * 864e5).toISOString();
    const today = new Date(Date.now() + 6 * 36e5).toISOString().slice(0, 10);
    const [sessions, breaks, shifts, tasks, requests, settings] = await Promise.all([
      rows(db(context, "attendance_sessions").select("*").eq("user_id", me).gte("clock_in_at", since).order("clock_in_at", { ascending: false }).limit(60)),
      rows(db(context, "attendance_breaks").select("*").eq("user_id", me).is("ended_at", null).limit(1)),
      rows(db(context, "attendance_shifts").select("*").eq("user_id", me).gte("shift_date", today).order("starts_at").limit(14)),
      rows(db(context, "attendance_tasks").select("*, items:attendance_task_items(*)").eq("assigned_to", me).in("status", ["pending", "in_progress", "rejected", "completed"]).order("due_date").limit(50)),
      rows(db(context, "attendance_requests").select("*").eq("user_id", me).order("created_at", { ascending: false }).limit(30)),
      rows(db(context, "attendance_settings").select("*").limit(1)),
    ]);
    return { sessions, openBreak: breaks[0] ?? null, shifts, tasks, requests, settings: settings[0] ?? null } as unknown as {
      sessions: import("@/integrations/supabase/attendance.types").AttendanceSessionRow[];
      openBreak: import("@/integrations/supabase/attendance.types").AttendanceBreakRow | null;
      shifts: import("@/integrations/supabase/attendance.types").AttendanceShiftRow[];
      tasks: (import("@/integrations/supabase/attendance.types").AttendanceTaskRow & { items: import("@/integrations/supabase/attendance.types").AttendanceTaskItemRow[] })[];
      requests: import("@/integrations/supabase/attendance.types").AttendanceRequestRow[];
      settings: import("@/integrations/supabase/attendance.types").AttendanceSettingsRow | null;
    };
  });

export const attendanceManagerOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertManager(context);
    const from = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const [open, recent, requests, tasks, stations, shifts, settings, team, isOwner] = await Promise.all([
      rows(db(context, "attendance_sessions").select("*").eq("status", "open").order("clock_in_at")),
      rows(db(context, "attendance_sessions").select("*").gte("clock_in_at", new Date(Date.now() - 7 * 864e5).toISOString()).order("clock_in_at", { ascending: false }).limit(100)),
      rows(db(context, "attendance_requests").select("*").eq("status", "pending").order("created_at")),
      rows(db(context, "attendance_tasks").select("*, items:attendance_task_items(*)").in("status", ["pending", "in_progress", "completed", "rejected"]).order("due_date").limit(100)),
      rows(db(context, "attendance_stations").select("*").order("sort_order")),
      rows(db(context, "attendance_shifts").select("*").gte("shift_date", from).order("starts_at").limit(200)),
      rows(db(context, "attendance_settings").select("*").limit(1)),
      callRpc(context, "attendance_team_directory", {}),
      (context.supabase as RpcClient).rpc("has_role", { _user_id: context.userId, _role: "owner" }).then((r) => r.data === true),
    ]);
    const openBreaks = await rows(db(context, "attendance_breaks").select("*").is("ended_at", null));
    // Phones are never sent to the browser.
    const safeTeam = (team ?? []).map((m) => ({ user_id: m.user_id, full_name: m.full_name, roles: m.roles }));
    return { open, recent, openBreaks, requests, tasks, stations, shifts, settings: settings[0] ?? null, team: safeTeam, isOwner } as unknown as {
      open: import("@/integrations/supabase/attendance.types").AttendanceSessionRow[];
      recent: import("@/integrations/supabase/attendance.types").AttendanceSessionRow[];
      openBreaks: import("@/integrations/supabase/attendance.types").AttendanceBreakRow[];
      requests: import("@/integrations/supabase/attendance.types").AttendanceRequestRow[];
      tasks: (import("@/integrations/supabase/attendance.types").AttendanceTaskRow & { items: import("@/integrations/supabase/attendance.types").AttendanceTaskItemRow[] })[];
      stations: import("@/integrations/supabase/attendance.types").AttendanceStationRow[];
      shifts: import("@/integrations/supabase/attendance.types").AttendanceShiftRow[];
      settings: import("@/integrations/supabase/attendance.types").AttendanceSettingsRow | null;
      team: { user_id: string; full_name: string | null; roles: string[] }[];
      isOwner: boolean;
    };
  });

/* ---------------------- Manager writes (RLS-enforced) --------------------- */

async function write(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) {
    console.error("[attendance] write failed:", error.message);
    throw new Error(error.message);
  }
  return { ok: true as const, id: ((data as { id?: string } | null)?.id ?? null) as string | null };
}

export const attendanceSaveStation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      id: uuid.optional(),
      name: z.string().trim().min(1).max(80),
      description: z.string().trim().max(300).nullish(),
      isActive: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const v = { name: data.name, description: data.description ?? null, is_active: data.isActive };
    if (data.id) return write(db(context, "attendance_stations").update(v).eq("id", data.id).select("id").single());
    return write(db(context, "attendance_stations").insert({ ...v, created_by: context.userId }).select("id").single());
  });

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

/** Recurring weekly schedule expands to one shift row per date (max 8 weeks). */
export const attendanceCreateShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      userId: uuid,
      stationId: uuid.nullish(),
      dutyRole: z.string().trim().max(60).nullish(),
      startDate: isoDate,
      weeks: z.number().int().min(1).max(8).default(1),
      weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      startTime: time,
      endTime: time,
      plannedBreakMinutes: z.number().int().min(0).max(240).default(0),
      notes: note,
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const dates: string[] = [];
    const start = Date.parse(`${data.startDate}T00:00:00Z`);
    for (let i = 0; i < data.weeks * 7; i++) {
      const day = new Date(start + i * 864e5);
      if (data.weekdays.includes(day.getUTCDay())) dates.push(day.toISOString().slice(0, 10));
    }
    const created: string[] = [];
    const failed: { date: string; error: string }[] = [];
    for (const shift_date of dates) {
      const { data: row, error } = await db(context, "attendance_shifts")
        .insert({
          user_id: data.userId, station_id: data.stationId ?? null, duty_role: data.dutyRole ?? null,
          shift_date, start_time: data.startTime, end_time: data.endTime,
          planned_break_minutes: data.plannedBreakMinutes, notes: data.notes ?? null, created_by: context.userId,
        })
        .select("id")
        .single();
      if (error) failed.push({ date: shift_date, error: /overlap|exclu/i.test(error.message) ? "Overlaps an existing shift" : error.message });
      else created.push((row as { id: string }).id);
    }
    return { created: created.length, failed };
  });

export const attendanceSetShiftStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ shiftId: uuid, status: z.enum(["scheduled", "cancelled", "on_leave"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return write(db(context, "attendance_shifts").update({ status: data.status }).eq("id", data.shiftId).select("id").single());
  });

export const attendanceCreateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      assignedTo: uuid,
      title: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).nullish(),
      dueDate: isoDate,
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      requiresVerification: z.boolean().default(true),
      items: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertManager(context);
    const task = (await write(
      db(context, "attendance_tasks").insert({
        assigned_to: data.assignedTo, assigned_by: context.userId, title: data.title,
        description: data.description ?? null, due_date: data.dueDate, priority: data.priority,
        requires_verification: data.requiresVerification,
      }).select("id").single(),
    )) as { id: string | null };
    if (!task.id) throw new Error("Task was not created");
    if (data.items.length) {
      await write(db(context, "attendance_task_items").insert(
        data.items.map((label, i) => ({ task_id: task.id, label, sort_order: i })),
      ));
    }
    return { id: task.id };
  });

export const attendanceCancelTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ taskId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context);
    return write(db(context, "attendance_tasks").update({ status: "cancelled" }).eq("id", data.taskId).in("status", ["pending", "in_progress", "rejected"]).select("id").single());
  });

/** Owner-only: admins/managers cannot change attendance rules. */
export const attendanceUpdateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      lateGraceMinutes: z.number().int().min(0).max(120),
      earlyClockInMinutes: z.number().int().min(0).max(240),
      minPunchGapSeconds: z.number().int().min(0).max(3600),
      maxSessionHours: z.number().int().min(1).max(24),
      allowUnscheduledClockIn: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context);
    return write(db(context, "attendance_settings").update({
      late_grace_minutes: data.lateGraceMinutes,
      early_clock_in_minutes: data.earlyClockInMinutes,
      min_punch_gap_seconds: data.minPunchGapSeconds,
      max_session_hours: data.maxSessionHours,
      allow_unscheduled_clock_in: data.allowUnscheduledClockIn,
      updated_by: context.userId,
    }).eq("id", true).select("id").single());
  });
