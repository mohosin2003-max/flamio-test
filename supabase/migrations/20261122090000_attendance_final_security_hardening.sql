-- FLAMIO ATTENDANCE MASTER — TEST ONLY
-- Final security/consistency hardening for attendance requests, overtime and breaks.
-- Production untouched.

-- 1) Enforce request/session ownership at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_id_user_id_uq
  ON public.attendance_sessions(id, user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'attendance_requests_session_owner_fkey'
      AND conrelid = 'public.attendance_requests'::regclass
  ) THEN
    ALTER TABLE public.attendance_requests
      ADD CONSTRAINT attendance_requests_session_owner_fkey
      FOREIGN KEY (session_id, user_id)
      REFERENCES public.attendance_sessions(id, user_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 2) Stop duplicate pending leave / missed-punch spam.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending_leave_range_idx
  ON public.attendance_requests(user_id, leave_start_date, leave_end_date)
  WHERE status = 'pending' AND request_type = 'leave';

CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending_missed_punch_date_idx
  ON public.attendance_requests(user_id, target_date)
  WHERE status = 'pending' AND request_type = 'missed_punch';

-- 3) Atomic break closure + session total update.
CREATE OR REPLACE FUNCTION public.attendance_end_break_as_service(
  _actor_id uuid,
  _break_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_break public.attendance_breaks%ROWTYPE;
  v_session public.attendance_sessions%ROWTYPE;
  v_end timestamptz := now();
  v_minutes integer;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff can end an attendance break';
  END IF;

  SELECT * INTO v_break
  FROM public.attendance_breaks
  WHERE id = _break_id
    AND user_id = _actor_id
    AND ended_at IS NULL
  FOR UPDATE;

  IF v_break.id IS NULL THEN
    RAISE EXCEPTION 'No active break was found';
  END IF;

  SELECT * INTO v_session
  FROM public.attendance_sessions
  WHERE id = v_break.session_id
    AND user_id = _actor_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Attendance session no longer exists';
  END IF;

  IF v_session.clock_out_at IS NOT NULL THEN
    -- The duty-end maintenance may have closed the session concurrently.
    -- Close the break at the authoritative session end without extending work.
    v_end := LEAST(v_end, v_session.clock_out_at);
  END IF;

  IF v_end <= v_break.started_at THEN
    RAISE EXCEPTION 'Break end time is invalid';
  END IF;

  v_minutes := floor(extract(epoch FROM (v_end - v_break.started_at)) / 60);

  UPDATE public.attendance_breaks
  SET ended_at = v_end, source = 'app', updated_at = now()
  WHERE id = v_break.id;

  UPDATE public.attendance_sessions
  SET break_minutes = COALESCE(v_session.break_minutes, 0) + v_minutes,
      updated_at = now()
  WHERE id = v_session.id;

  RETURN v_minutes;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_end_break_as_service(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_end_break_as_service(uuid, uuid)
  TO service_role;

-- 4) Service bridge for manager session verification.
CREATE OR REPLACE FUNCTION public.attendance_verify_session_as_service(
  _session_id uuid,
  _status text,
  _note text,
  _actor_id uuid
)
RETURNS public.attendance_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_session public.attendance_sessions%ROWTYPE;
BEGIN
  IF _actor_id IS NULL
     OR NOT (
       public.has_role(_actor_id, 'owner'::public.app_role)
       OR public.has_role(_actor_id, 'admin'::public.app_role)
     )
  THEN
    RAISE EXCEPTION 'Only an Owner or Manager can review attendance sessions';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', _actor_id::text, true);

  SELECT * INTO v_session
  FROM public.attendance_verify_session(_session_id, _status, _note);

  RETURN v_session;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_verify_session_as_service(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session_as_service(uuid, text, text, uuid)
  TO service_role;

-- 5) Rebuild the authoritative overtime approval function with the early-leave guard.
CREATE OR REPLACE FUNCTION public.attendance_review_request(
  _request_id uuid,
  _approve boolean,
  _note text DEFAULT NULL
)
RETURNS public.attendance_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  q public.attendance_requests%ROWTYPE;
  s public.attendance_sessions%ROWTYPE;
  sh public.attendance_shifts%ROWTYPE;
  v_session uuid;
  v_shift uuid;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  SELECT * INTO q
  FROM public.attendance_requests
  WHERE id = _request_id
  FOR UPDATE;

  IF q.id IS NULL OR q.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is not pending';
  END IF;

  IF q.user_id = v_uid AND NOT public.has_role(v_uid, 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'You cannot approve your own request';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('attendance:' || q.user_id::text, 0)
  );

  IF _approve THEN
    IF q.request_type = 'leave' THEN
      UPDATE public.attendance_shifts
      SET status = 'on_leave'
      WHERE user_id = q.user_id
        AND status = 'scheduled'
        AND shift_date BETWEEN q.leave_start_date AND q.leave_end_date;

    ELSIF q.request_type = 'missed_punch' THEN
      IF q.requested_clock_in IS NULL OR q.requested_clock_out IS NULL THEN
        RAISE EXCEPTION 'A missed-punch approval needs both clock-in and clock-out';
      END IF;

      PERFORM public.attendance_assert_valid_window(
        q.user_id, NULL, q.requested_clock_in, q.requested_clock_out
      );

      v_shift := public.attendance_match_shift(
        q.user_id, q.requested_clock_in
      );

      INSERT INTO public.attendance_sessions (
        user_id, shift_id, duty_date, clock_in_at, clock_out_at,
        clock_in_source, clock_out_source, status, session_kind
      )
      VALUES (
        q.user_id,
        v_shift,
        COALESCE(
          (SELECT shift_date FROM public.attendance_shifts WHERE id = v_shift),
          public.attendance_local_date(q.requested_clock_in)
        ),
        q.requested_clock_in,
        q.requested_clock_out,
        'correction',
        'correction',
        'corrected',
        'normal'
      )
      RETURNING id INTO v_session;

      IF v_shift IS NOT NULL THEN
        UPDATE public.attendance_shifts
        SET status = 'completed'
        WHERE id = v_shift;
      END IF;

    ELSIF q.request_type = 'correction' THEN
      SELECT * INTO s
      FROM public.attendance_sessions
      WHERE id = q.session_id
        AND user_id = q.user_id
      FOR UPDATE;

      IF s.id IS NULL THEN
        RAISE EXCEPTION 'Session no longer exists or does not belong to the requester';
      END IF;

      PERFORM public.attendance_apply_session_times(
        s.id,
        COALESCE(q.requested_clock_in, s.clock_in_at),
        COALESCE(q.requested_clock_out, s.clock_out_at),
        'correction',
        NULL
      );

      v_session := s.id;

    ELSIF q.request_type = 'overtime' THEN
      IF q.requested_overtime_minutes NOT IN (30,60,90,120) THEN
        RAISE EXCEPTION 'Invalid overtime duration';
      END IF;

      SELECT * INTO s
      FROM public.attendance_sessions
      WHERE id = q.session_id
        AND user_id = q.user_id
      FOR UPDATE;

      IF s.id IS NULL THEN
        RAISE EXCEPTION 'Attendance session no longer exists or does not belong to the requester';
      END IF;

      IF s.session_kind <> 'normal' THEN
        RAISE EXCEPTION 'Overtime must be based on a normal duty session';
      END IF;

      IF s.shift_id IS NULL THEN
        RAISE EXCEPTION 'Overtime requires a scheduled shift';
      END IF;

      SELECT * INTO sh
      FROM public.attendance_shifts
      WHERE id = s.shift_id
      FOR UPDATE;

      IF sh.id IS NULL THEN
        RAISE EXCEPTION 'Shift no longer exists';
      END IF;

      IF sh.ends_at < date_trunc('day', now() AT TIME ZONE 'Asia/Dhaka')
                           AT TIME ZONE 'Asia/Dhaka' THEN
        RAISE EXCEPTION 'Overtime is not allowed for a past duty date';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE overtime_request_id = q.id
      ) THEN
        RAISE EXCEPTION 'Overtime has already been started';
      END IF;

      -- Early departure is a hard business-rule block. The comparison is
      -- authoritative and does not rely only on the derived early_leave_minutes.
      IF s.clock_out_at IS NOT NULL AND s.clock_out_at < sh.ends_at THEN
        RAISE EXCEPTION 'Overtime is not allowed after an early clock-out';
      END IF;

      IF s.early_leave_minutes > 0 THEN
        RAISE EXCEPTION 'Overtime is not allowed for a session with early leave';
      END IF;

      IF s.clock_out_at IS NULL AND now() < sh.ends_at THEN
        -- Approved before duty end: schedule only. Maintenance starts it exactly
        -- at the scheduled duty end.
        v_start := sh.ends_at;
        v_end := sh.ends_at + make_interval(mins => q.requested_overtime_minutes);

        UPDATE public.attendance_requests
        SET approved_overtime_start_at = v_start,
            approved_overtime_end_at = v_end
        WHERE id = q.id;

        v_session := NULL;

      ELSIF s.clock_out_at IS NOT NULL
        AND s.clock_out_at >= sh.ends_at
        AND now() >= sh.ends_at THEN
        -- Post-end approval: starts at actual approval time. Never backdated.
        v_start := now();
        v_end := v_start + make_interval(mins => q.requested_overtime_minutes);

        UPDATE public.attendance_requests
        SET approved_overtime_start_at = v_start,
            approved_overtime_end_at = v_end
        WHERE id = q.id;

      ELSIF s.clock_out_at IS NULL AND now() >= sh.ends_at THEN
        -- Normal duty may not remain open past the scheduled end.
        PERFORM public.attendance_process_duty_end_and_overtime();

        SELECT * INTO s
        FROM public.attendance_sessions
        WHERE id = q.session_id
          AND user_id = q.user_id
        FOR UPDATE;

        IF s.clock_out_at IS NULL THEN
          RAISE EXCEPTION 'Normal duty has not been closed yet';
        END IF;

        IF s.clock_out_at < sh.ends_at OR s.early_leave_minutes > 0 THEN
          RAISE EXCEPTION 'Overtime is not allowed after an early clock-out';
        END IF;

        v_start := now();
        v_end := v_start + make_interval(mins => q.requested_overtime_minutes);

        UPDATE public.attendance_requests
        SET approved_overtime_start_at = v_start,
            approved_overtime_end_at = v_end
        WHERE id = q.id;

      ELSE
        RAISE EXCEPTION 'Overtime request is not in a valid start state';
      END IF;

      IF v_start <= now() THEN
        INSERT INTO public.attendance_sessions (
          user_id, shift_id, duty_date,
          clock_in_at, clock_out_at,
          clock_in_source, clock_in_note,
          status, session_kind, overtime_request_id
        )
        VALUES (
          q.user_id,
          s.shift_id,
          s.duty_date,
          v_start,
          NULL,
          'manager',
          'Approved overtime',
          'open',
          'overtime',
          q.id
        )
        RETURNING id INTO v_session;
      END IF;
    END IF;

    IF v_session IS NOT NULL THEN
      PERFORM public.attendance_recalculate_session(v_session);
    END IF;
  END IF;

  UPDATE public.attendance_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_note = NULLIF(btrim(_note), ''),
      applied_session_id = v_session
  WHERE id = q.id
  RETURNING * INTO q;

  RETURN q;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_review_request(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;

-- Ensure the authoritative maintenance function remains service-role only.
REVOKE EXECUTE ON FUNCTION public.attendance_process_duty_end_and_overtime()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_process_duty_end_and_overtime()
  TO service_role;
