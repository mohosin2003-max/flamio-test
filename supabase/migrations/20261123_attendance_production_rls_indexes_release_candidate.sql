-- FLAMIO ATTENDANCE MASTER — Production RLS + index release candidate
-- DO NOT APPLY TO PRODUCTION YET.
-- Generated from verified TEST policy/index state.
-- SECURITY DEFINER functions and service-role paths remain responsible for writes
-- where no direct authenticated write policy exists.

ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_breaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_task_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_location_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_qr_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_settings_member_read ON public.attendance_settings
  FOR SELECT TO authenticated
  USING (attendance_is_member(auth.uid()));

CREATE POLICY attendance_settings_owner_update ON public.attendance_settings
  FOR UPDATE TO authenticated
  USING (has_role((SELECT auth.uid()), 'owner'::app_role))
  WITH CHECK (has_role((SELECT auth.uid()), 'owner'::app_role));

CREATE POLICY attendance_stations_member_read ON public.attendance_stations
  FOR SELECT TO authenticated
  USING (attendance_is_member(auth.uid()));

CREATE POLICY attendance_stations_manager_write ON public.attendance_stations
  FOR ALL TO authenticated
  USING (attendance_is_manager(auth.uid()))
  WITH CHECK (attendance_is_manager(auth.uid()));

CREATE POLICY attendance_shifts_own_read ON public.attendance_shifts
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR attendance_is_manager(auth.uid()));

CREATE POLICY attendance_shifts_manager_write ON public.attendance_shifts
  FOR ALL TO authenticated
  USING (attendance_is_manager(auth.uid()))
  WITH CHECK (attendance_is_manager(auth.uid()) AND attendance_is_member(user_id));

CREATE POLICY attendance_sessions_own_read ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR attendance_is_manager(auth.uid()));

CREATE POLICY attendance_breaks_own_read ON public.attendance_breaks
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR attendance_is_manager(auth.uid()));

CREATE POLICY attendance_requests_own_read ON public.attendance_requests
  FOR SELECT TO authenticated
  USING ((user_id = auth.uid()) OR attendance_is_manager(auth.uid()));

CREATE POLICY attendance_tasks_own_read ON public.attendance_tasks
  FOR SELECT TO authenticated
  USING ((assigned_to = auth.uid()) OR attendance_is_manager(auth.uid()));

CREATE POLICY attendance_tasks_manager_write ON public.attendance_tasks
  FOR ALL TO authenticated
  USING (attendance_is_manager(auth.uid()))
  WITH CHECK (attendance_is_manager(auth.uid()) AND attendance_is_member(assigned_to));

CREATE POLICY attendance_task_items_own_read ON public.attendance_task_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.attendance_tasks t
      WHERE t.id = attendance_task_items.task_id
        AND ((t.assigned_to = auth.uid()) OR attendance_is_manager(auth.uid()))
    )
  );

CREATE POLICY attendance_task_items_manager_write ON public.attendance_task_items
  FOR ALL TO authenticated
  USING (attendance_is_manager(auth.uid()))
  WITH CHECK (attendance_is_manager(auth.uid()));

CREATE POLICY attendance_location_events_owner_read ON public.attendance_location_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'owner'::app_role));

CREATE POLICY attendance_audit_manager_read ON public.attendance_audit_log
  FOR SELECT TO authenticated
  USING (attendance_is_manager(auth.uid()));

CREATE INDEX IF NOT EXISTS attendance_shifts_user_date_idx
  ON public.attendance_shifts (user_id, shift_date);

CREATE INDEX IF NOT EXISTS attendance_shifts_user_starts_idx
  ON public.attendance_shifts (user_id, starts_at);

CREATE INDEX IF NOT EXISTS attendance_shifts_date_status_idx
  ON public.attendance_shifts (shift_date, status);

CREATE INDEX IF NOT EXISTS attendance_sessions_user_date_idx
  ON public.attendance_sessions (user_id, duty_date);

CREATE INDEX IF NOT EXISTS attendance_sessions_date_status_idx
  ON public.attendance_sessions (duty_date, status);

CREATE INDEX IF NOT EXISTS attendance_sessions_shift_idx
  ON public.attendance_sessions (shift_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_open_idx
  ON public.attendance_sessions (user_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS attendance_sessions_open_kind_idx
  ON public.attendance_sessions (user_id, session_kind, status)
  WHERE status = 'open';

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_overtime_session_per_request_idx
  ON public.attendance_sessions (overtime_request_id)
  WHERE session_kind = 'overtime' AND overtime_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_selfie_path_uq
  ON public.attendance_sessions (clock_in_selfie_path)
  WHERE clock_in_selfie_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_sessions_unverified_idx
  ON public.attendance_sessions (duty_date, verification_status)
  WHERE verification_status = 'unverified';

CREATE INDEX IF NOT EXISTS attendance_breaks_user_idx
  ON public.attendance_breaks (user_id, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_open_idx
  ON public.attendance_breaks (session_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_tasks_assignee_idx
  ON public.attendance_tasks (assigned_to, due_date);

CREATE INDEX IF NOT EXISTS attendance_tasks_date_status_idx
  ON public.attendance_tasks (due_date, status);

CREATE INDEX IF NOT EXISTS attendance_tasks_shift_idx
  ON public.attendance_tasks (shift_id);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_tasks_photo_path_uq
  ON public.attendance_tasks (photo_path)
  WHERE photo_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_task_items_task_idx
  ON public.attendance_task_items (task_id, sort_order);

CREATE INDEX IF NOT EXISTS attendance_requests_user_status_idx
  ON public.attendance_requests (user_id, status);

CREATE INDEX IF NOT EXISTS attendance_requests_pending_idx
  ON public.attendance_requests (created_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending_session_idx
  ON public.attendance_requests (session_id)
  WHERE status = 'pending' AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending_missed_punch_date_idx
  ON public.attendance_requests (user_id, target_date)
  WHERE status = 'pending' AND request_type = 'missed_punch' AND target_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_requests_overtime_pending_approved_idx
  ON public.attendance_requests (user_id, status, approved_overtime_start_at)
  WHERE request_type = 'overtime' AND status IN ('pending','approved');

CREATE INDEX IF NOT EXISTS attendance_location_events_user_time_idx
  ON public.attendance_location_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS attendance_location_events_session_time_idx
  ON public.attendance_location_events (session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS attendance_qr_challenges_expiry_idx
  ON public.attendance_qr_challenges (expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_audit_row_idx
  ON public.attendance_audit_log (table_name, row_id, created_at DESC);

CREATE INDEX IF NOT EXISTS attendance_audit_subject_idx
  ON public.attendance_audit_log (subject_user_id, created_at DESC);
