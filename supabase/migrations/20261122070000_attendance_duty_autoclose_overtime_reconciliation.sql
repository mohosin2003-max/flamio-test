-- FLAMIO ATTENDANCE MASTER
-- TEST-only reconciliation: normal duty auto-close + bounded overtime.
-- Generated from the current TEST Supabase definitions. Production untouched.

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS session_kind text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS overtime_request_id uuid;

ALTER TABLE public.attendance_requests
  ADD COLUMN IF NOT EXISTS approved_overtime_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_overtime_end_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_overtime_session_per_request_idx
  ON public.attendance_sessions(overtime_request_id)
  WHERE overtime_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_sessions_open_kind_idx
  ON public.attendance_sessions(user_id, session_kind, clock_out_at)
  WHERE clock_out_at IS NULL;

CREATE INDEX IF NOT EXISTS attendance_requests_overtime_pending_approved_idx
  ON public.attendance_requests(user_id, target_date, status, request_type)
  WHERE request_type = 'overtime' AND status IN ('pending','approved');

CREATE OR REPLACE FUNCTION public.attendance_process_duty_end_and_overtime()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_s public.attendance_sessions%ROWTYPE;
  v_q public.attendance_requests%ROWTYPE;
  v_sh public.attendance_shifts%ROWTYPE;
  v_count integer := 0;
  v_ot_session uuid;
  v_end timestamptz;
BEGIN
  FOR v_s IN
    SELECT s.*
    FROM public.attendance_sessions s
    JOIN public.attendance_shifts x ON x.id = s.shift_id
    WHERE s.clock_out_at IS NULL
      AND s.session_kind = 'normal'
      AND x.ends_at <= now()
    ORDER BY x.ends_at, s.clock_in_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    SELECT x.* INTO v_sh
    FROM public.attendance_shifts x
    WHERE x.id = v_s.shift_id
    FOR UPDATE;

    UPDATE public.attendance_breaks
    SET ended_at = v_sh.ends_at, source = 'auto', updated_at = now()
    WHERE session_id = v_s.id AND ended_at IS NULL AND started_at < v_sh.ends_at;

    UPDATE public.attendance_sessions
    SET clock_out_at = v_sh.ends_at,
        clock_out_source = 'auto',
        clock_out_note = 'auto_closed_normal_duty_end',
        status = 'auto_closed',
        updated_at = now()
    WHERE id = v_s.id AND clock_out_at IS NULL;

    IF FOUND THEN
      v_count := v_count + 1;
      UPDATE public.attendance_shifts
      SET status = 'completed'
      WHERE id = v_sh.id AND status = 'in_progress';
      PERFORM public.attendance_recalculate_session(v_s.id);
    END IF;

    SELECT r.* INTO v_q
    FROM public.attendance_requests r
    WHERE r.request_type = 'overtime'
      AND r.status = 'approved'
      AND r.session_id = v_s.id
      AND r.reviewed_at <= v_sh.ends_at
      AND r.requested_overtime_minutes IN (30,60,90,120)
      AND r.applied_session_id IS NULL
    ORDER BY r.reviewed_at
    LIMIT 1
    FOR UPDATE;

    IF v_q.id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.attendance_sessions
         WHERE overtime_request_id = v_q.id
       )
    THEN
      INSERT INTO public.attendance_sessions (
        user_id, shift_id, duty_date, clock_in_at, clock_in_source,
        clock_in_note, status, session_kind, overtime_request_id
      )
      VALUES (
        v_s.user_id, v_s.shift_id, v_s.duty_date, v_sh.ends_at,
        'manager', 'Pre-approved overtime started at duty end',
        'open', 'overtime', v_q.id
      )
      RETURNING id INTO v_ot_session;

      UPDATE public.attendance_requests
      SET applied_session_id = v_ot_session,
          approved_overtime_start_at = v_sh.ends_at,
          approved_overtime_end_at =
            v_sh.ends_at + make_interval(mins => v_q.requested_overtime_minutes),
          updated_at = now()
      WHERE id = v_q.id;

      PERFORM public.attendance_recalculate_session(v_ot_session);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  FOR v_s IN
    SELECT s.*
    FROM public.attendance_sessions s
    JOIN public.attendance_requests r ON r.id = s.overtime_request_id
    WHERE s.clock_out_at IS NULL
      AND s.session_kind = 'overtime'
      AND r.status = 'approved'
      AND r.approved_overtime_end_at IS NOT NULL
      AND r.approved_overtime_end_at <= now()
    ORDER BY r.approved_overtime_end_at, s.clock_in_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    SELECT r.approved_overtime_end_at INTO v_end
    FROM public.attendance_requests r
    WHERE r.id = v_s.overtime_request_id AND r.status = 'approved';

    UPDATE public.attendance_sessions
    SET clock_out_at = v_end,
        clock_out_source = 'auto',
        clock_out_note = 'auto_closed_overtime_end',
        status = 'closed',
        updated_at = now()
    WHERE id = v_s.id AND clock_out_at IS NULL;

    IF FOUND THEN
      PERFORM public.attendance_recalculate_session(v_s.id);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- Keep the TEST scheduler authoritative and app-independent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'attendance-duty-end-overtime-maintenance') THEN
    PERFORM cron.unschedule('attendance-duty-end-overtime-maintenance');
  END IF;
  PERFORM cron.schedule(
    'attendance-duty-end-overtime-maintenance',
    '* * * * *',
    'select public.attendance_process_duty_end_and_overtime();'
  );
END $$;
