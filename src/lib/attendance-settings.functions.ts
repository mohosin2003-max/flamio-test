import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAccessProfile } from "@/lib/owner.server";

const settingsInput = z.object({
  timezone: z.literal("Asia/Dhaka"),
  lateGraceMinutes: z.number().int().min(0).max(120),
  earlyClockInMinutes: z.number().int().min(0).max(240),
  minPunchGapSeconds: z.number().int().min(10).max(3600),
  maxSessionHours: z.number().int().min(1).max(24),
  allowUnscheduledClockIn: z.boolean(),
  geofenceEnabled: z.boolean(),
  qrVerificationEnabled: z.boolean(),
  selfieVerificationEnabled: z.boolean(),
  attendanceAlertsEnabled: z.boolean(),
});

export const ownerUpdateAttendanceSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => settingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const access = await getAccessProfile(context.userId);
    if (!access.isOwner) throw new Error("Only the Owner can change attendance settings.");
    const { untypedAdmin } = await import("@/lib/untyped-db.server");
    const db = await untypedAdmin();
    const { data: previous, error: readError } = await db.from("attendance_settings")
      .select("timezone, late_grace_minutes, early_clock_in_minutes, min_punch_gap_seconds, max_session_hours, allow_unscheduled_clock_in, geofence_enabled, qr_verification_enabled, selfie_verification_enabled, attendance_alerts_enabled")
      .eq("id", true).maybeSingle();
    if (readError || !previous) throw new Error("Attendance settings were not found.");
    const updated = {
      timezone: data.timezone,
      late_grace_minutes: data.lateGraceMinutes,
      early_clock_in_minutes: data.earlyClockInMinutes,
      min_punch_gap_seconds: data.minPunchGapSeconds,
      max_session_hours: data.maxSessionHours,
      allow_unscheduled_clock_in: data.allowUnscheduledClockIn,
      geofence_enabled: data.geofenceEnabled,
      qr_verification_enabled: data.qrVerificationEnabled,
      selfie_verification_enabled: data.selfieVerificationEnabled,
      attendance_alerts_enabled: data.attendanceAlertsEnabled,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from("attendance_settings").update(updated).eq("id", true);
    if (error) {
      console.error("Attendance settings update failed", error.message);
      throw new Error("Could not save attendance settings.");
    }
    const { error: auditError } = await db.from("attendance_audit_log").insert({
      table_name: "attendance_settings",
      row_id: null,
      action: "UPDATE",
      actor_id: context.userId,
      old_data: previous,
      new_data: { ...updated, _attendance_event: "settings_updated" },
    });
    if (auditError) console.error("Attendance settings audit log failed", auditError.message);
    return { ok: true };
  });
