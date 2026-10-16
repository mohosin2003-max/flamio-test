/**
 * FLAMIO ATTENDANCE MASTER — hand-written types.
 *
 * Source of truth: docs/sql/attendance_master_schema.sql (the file applied to
 * the TEST project). Kept separate from the generated `types.ts` on purpose —
 * never merge into or regenerate that file. Only RPCs granted to
 * `authenticated` are listed in `AttendanceRpc`; internal helpers and the
 * service-role maintenance job are deliberately excluded.
 */

export type AttendanceAppRole = "owner" | "admin" | "staff" | (string & {});

export type AttendanceShiftStatus =
  | "scheduled" | "in_progress" | "completed" | "missed" | "cancelled" | "on_leave";
export type AttendanceSessionStatus = "open" | "closed" | "auto_closed" | "corrected";
export type AttendanceVerificationStatus = "unverified" | "verified" | "disputed";
export type AttendanceClockInSource = "app" | "kiosk" | "manager" | "correction";
export type AttendanceClockOutSource = AttendanceClockInSource | "auto";
export type AttendanceBreakSource = AttendanceClockOutSource;
export type AttendanceTaskPriority = "low" | "medium" | "high" | "urgent";
export type AttendanceTaskStatus =
  | "pending" | "in_progress" | "completed" | "verified" | "rejected" | "cancelled";
export type AttendanceRequestType = "leave" | "missed_punch" | "correction" | "overtime";
export type AttendanceLeaveType = "casual" | "sick" | "annual" | "unpaid" | "emergency" | "other";
export type AttendanceRequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AttendanceAuditAction = "INSERT" | "UPDATE" | "DELETE";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface AttendanceSettingsRow {
  id: boolean;
  timezone: string;
  late_grace_minutes: number;
  early_clock_in_minutes: number;
  min_punch_gap_seconds: number;
  max_session_hours: number;
  allow_unscheduled_clock_in: boolean;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceStationRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceShiftRow {
  id: string;
  user_id: string;
  station_id: string | null;
  duty_role: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  is_overnight: boolean;
  planned_break_minutes: number;
  status: AttendanceShiftStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSessionRow {
  id: string;
  user_id: string;
  shift_id: string | null;
  duty_date: string;
  clock_in_at: string;
  clock_out_at: string | null;
  clock_in_source: AttendanceClockInSource;
  clock_out_source: AttendanceClockOutSource | null;
  clock_in_note: string | null;
  clock_out_note: string | null;
  break_minutes: number;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  status: AttendanceSessionStatus;
  flags: string[];
  verification_status: AttendanceVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  verification_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceBreakRow {
  id: string;
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  source: AttendanceBreakSource;
  created_at: string;
  updated_at: string;
}

export interface AttendanceTaskRow {
  id: string;
  assigned_to: string;
  assigned_by: string | null;
  shift_id: string | null;
  station_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  due_at: string | null;
  priority: AttendanceTaskPriority;
  status: AttendanceTaskStatus;
  requires_verification: boolean;
  started_at: string | null;
  completed_at: string | null;
  completion_note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceTaskItemRow {
  id: string;
  task_id: string;
  label: string;
  sort_order: number;
  is_done: boolean;
  done_at: string | null;
  done_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceRequestRow {
  id: string;
  user_id: string;
  request_type: AttendanceRequestType;
  leave_type: AttendanceLeaveType | null;
  leave_start_date: string | null;
  leave_end_date: string | null;
  session_id: string | null;
  target_date: string | null;
  requested_clock_in: string | null;
  requested_clock_out: string | null;
  requested_overtime_minutes: number | null;
  reason: string;
  status: AttendanceRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  applied_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceAuditLogRow {
  id: number;
  table_name: string;
  row_id: string | null;
  action: AttendanceAuditAction;
  actor_id: string | null;
  subject_user_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  created_at: string;
}

/** The 9 attendance tables, keyed by table name (row shape only). */
export interface AttendanceTables {
  attendance_settings: AttendanceSettingsRow;
  attendance_stations: AttendanceStationRow;
  attendance_shifts: AttendanceShiftRow;
  attendance_sessions: AttendanceSessionRow;
  attendance_breaks: AttendanceBreakRow;
  attendance_tasks: AttendanceTaskRow;
  attendance_task_items: AttendanceTaskItemRow;
  attendance_requests: AttendanceRequestRow;
  attendance_audit_log: AttendanceAuditLogRow;
}

export interface AttendanceTeamMember {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  roles: AttendanceAppRole[];
}

/** RPCs granted EXECUTE to `authenticated`. Args with SQL defaults are optional. */
export interface AttendanceRpc {
  attendance_is_manager: { Args: { _user_id: string }; Returns: boolean };
  attendance_is_member: { Args: { _user_id: string }; Returns: boolean };
  attendance_clock_in: {
    Args: { _note?: string | null; _source?: AttendanceClockInSource };
    Returns: AttendanceSessionRow;
  };
  attendance_clock_out: {
    Args: { _note?: string | null; _source?: AttendanceClockInSource };
    Returns: AttendanceSessionRow;
  };
  attendance_start_break: { Args: Record<string, never>; Returns: AttendanceBreakRow };
  attendance_end_break: { Args: Record<string, never>; Returns: AttendanceBreakRow };
  attendance_update_task_progress: {
    Args: { _task_id: string; _status: AttendanceTaskStatus; _note?: string | null };
    Returns: AttendanceTaskRow;
  };
  attendance_toggle_task_item: {
    Args: { _item_id: string; _done: boolean };
    Returns: AttendanceTaskItemRow;
  };
  attendance_review_task: {
    Args: { _task_id: string; _approve: boolean; _note?: string | null };
    Returns: AttendanceTaskRow;
  };
  attendance_submit_request: {
    Args: {
      _request_type: AttendanceRequestType;
      _reason: string;
      _leave_type?: AttendanceLeaveType | null;
      _leave_start_date?: string | null;
      _leave_end_date?: string | null;
      _session_id?: string | null;
      _target_date?: string | null;
      _requested_clock_in?: string | null;
      _requested_clock_out?: string | null;
      _requested_overtime_minutes?: number | null;
    };
    Returns: AttendanceRequestRow;
  };
  attendance_cancel_request: { Args: { _request_id: string }; Returns: AttendanceRequestRow };
  attendance_review_request: {
    Args: { _request_id: string; _approve: boolean; _note?: string | null };
    Returns: AttendanceRequestRow;
  };
  attendance_verify_session: {
    Args: { _session_id: string; _status: AttendanceVerificationStatus; _note?: string | null };
    Returns: AttendanceSessionRow;
  };
  attendance_manager_correct_session: {
    Args: { _session_id: string; _clock_in_at: string; _clock_out_at: string; _reason: string };
    Returns: AttendanceSessionRow;
  };
  attendance_team_directory: { Args: Record<string, never>; Returns: AttendanceTeamMember[] };
}

export type AttendanceRpcName = keyof AttendanceRpc;
