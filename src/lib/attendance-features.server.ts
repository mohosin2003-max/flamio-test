import { assertAttendanceActionAllowed, assertTasksFeatureAllowed, readFeatureToggles, type AttendanceAction, type FeatureToggles } from "@/lib/attendance-rules";

/** Reads toggles with select("*") so missing columns (migration not applied) fail safe to ON. */
export async function loadFeatureToggles(db: { from: (t: string) => any }): Promise<FeatureToggles & { columnsPresent: boolean }> {
  const { data, error } = await db.from("attendance_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw new Error("Attendance settings are not available.");
  const row = (data ?? null) as Record<string, unknown> | null;
  return { ...readFeatureToggles(row), columnsPresent: Boolean(row && "attendance_enabled" in row && "tasks_enabled" in row) };
}

export async function requireAttendanceFeature(db: { from: (t: string) => any }, action: AttendanceAction) {
  const t = await loadFeatureToggles(db);
  assertAttendanceActionAllowed(t.attendanceEnabled, action);
}

export async function requireTasksFeature(db: { from: (t: string) => any }) {
  const t = await loadFeatureToggles(db);
  assertTasksFeatureAllowed(t.tasksEnabled);
}
