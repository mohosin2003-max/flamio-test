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
    return callRpc(context, "attendance_team_directory", {});
  });
