import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";

export const ownerGetAttendanceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner) throw new Error("Forbidden");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();

    const [settingsResult, sessionsResult, tasksResult] = await Promise.all([
      db.from("attendance_settings")
        .select("timezone, late_grace_minutes, early_clock_in_minutes, min_punch_gap_seconds, max_session_hours, allow_unscheduled_clock_in, geofence_enabled, qr_verification_enabled, selfie_verification_enabled, attendance_alerts_enabled, updated_at")
        .eq("id", true)
        .maybeSingle(),
      db.from("attendance_sessions")
        .select("id, user_id, duty_date, clock_in_at, clock_out_at, worked_minutes, late_minutes, status, verification_status")
        .order("clock_in_at", { ascending: false })
        .limit(20),
      db.from("attendance_tasks")
        .select("id, assigned_to, title, due_date, due_at, priority, status, completed_at")
        .order("due_date", { ascending: false })
        .limit(20),
    ]);

    if (settingsResult.error || sessionsResult.error || tasksResult.error) {
      console.error("Attendance overview read failed", {
        settings: settingsResult.error?.message,
        sessions: sessionsResult.error?.message,
        tasks: tasksResult.error?.message,
      });
      throw new Error("Attendance data could not be loaded. Confirm the TEST database setup before continuing.");
    }

    const ids = Array.from(new Set([
      ...(sessionsResult.data ?? []).map((row: { user_id: string }) => row.user_id),
      ...(tasksResult.data ?? []).map((row: { assigned_to: string }) => row.assigned_to),
    ]));
    const profilesResult = ids.length
      ? await db.from("profiles").select("id, full_name").in("id", ids)
      : { data: [], error: null };
    if (profilesResult.error) {
      console.error("Attendance profile lookup failed", profilesResult.error.message);
      throw new Error("Staff names could not be loaded.");
    }
    const names = new Map<string, string>(
      (profilesResult.data ?? []).map((row: { id: string; full_name: string | null }) => [
        row.id,
        row.full_name?.trim() || "Unnamed staff",
      ]),
    );

    return {
      settings: settingsResult.data,
      sessions: (sessionsResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        userId: String(row.user_id),
        staffName: names.get(String(row.user_id)) ?? "Staff member",
        dutyDate: String(row.duty_date),
        clockInAt: String(row.clock_in_at),
        clockOutAt: row.clock_out_at ? String(row.clock_out_at) : null,
        workedMinutes: Number(row.worked_minutes ?? 0),
        lateMinutes: Number(row.late_minutes ?? 0),
        status: String(row.status),
        verificationStatus: String(row.verification_status),
      })),
      tasks: (tasksResult.data ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        staffName: names.get(String(row.assigned_to)) ?? "Staff member",
        title: String(row.title),
        dueDate: String(row.due_date),
        dueAt: row.due_at ? String(row.due_at) : null,
        priority: String(row.priority),
        status: String(row.status),
        completedAt: row.completed_at ? String(row.completed_at) : null,
      })),
    };
  });
