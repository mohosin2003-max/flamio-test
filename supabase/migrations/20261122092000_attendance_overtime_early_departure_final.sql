-- FLAMIO ATTENDANCE MASTER — TEST ONLY
-- Final maintenance hardening: invalidate pre-approved overtime after early departure.
-- Production untouched.

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
  v_count integer:=0;
  v_ot_session uuid;
  v_end timestamptz;
BEGIN
  FOR v_s IN
    SELECT s.* FROM public.attendance_sessions s
    JOIN public.attendance_shifts x ON x.id=s.shift_id
    WHERE s.clock_out_at IS NULL AND s.session_kind='normal' AND x.ends_at<=now()
    ORDER BY x.ends_at,s.clock_in_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    SELECT x.* INTO v_sh FROM public.attendance_shifts x WHERE x.id=v_s.shift_id FOR UPDATE;

    UPDATE public.attendance_breaks
    SET ended_at=v_sh.ends_at,source='auto',updated_at=now()
    WHERE session_id=v_s.id AND ended_at IS NULL AND started_at<v_sh.ends_at;

    UPDATE public.attendance_sessions
    SET clock_out_at=v_sh.ends_at,clock_out_source='auto',
        clock_out_note='auto_closed_normal_duty_end',status='auto_closed',updated_at=now()
    WHERE id=v_s.id AND clock_out_at IS NULL;

    IF FOUND THEN
      v_count:=v_count+1;
      UPDATE public.attendance_shifts SET status='completed'
      WHERE id=v_sh.id AND status='in_progress';
      PERFORM public.attendance_recalculate_session(v_s.id);
    END IF;

    SELECT r.* INTO v_q
    FROM public.attendance_requests r
    WHERE r.request_type='overtime' AND r.status='approved'
      AND r.session_id=v_s.id AND r.reviewed_at<=v_sh.ends_at
      AND r.requested_overtime_minutes IN(30,60,90,120)
      AND r.applied_session_id IS NULL
    ORDER BY r.reviewed_at LIMIT 1 FOR UPDATE;

    IF v_q.id IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.attendance_sessions WHERE overtime_request_id=v_q.id)
    THEN
      INSERT INTO public.attendance_sessions(
        user_id,shift_id,duty_date,clock_in_at,clock_in_source,clock_in_note,
        status,session_kind,overtime_request_id
      )
      VALUES(
        v_s.user_id,v_s.shift_id,v_s.duty_date,v_sh.ends_at,'manager',
        'Pre-approved overtime started at duty end','open','overtime',v_q.id
      )
      RETURNING id INTO v_ot_session;

      UPDATE public.attendance_requests
      SET applied_session_id=v_ot_session,
          approved_overtime_start_at=v_sh.ends_at,
          approved_overtime_end_at=v_sh.ends_at+make_interval(mins=>v_q.requested_overtime_minutes),
          updated_at=now()
      WHERE id=v_q.id;

      PERFORM public.attendance_recalculate_session(v_ot_session);
      v_count:=v_count+1;
    END IF;
  END LOOP;

  -- If the employee clocked out early after pre-approval, never create false OT.
  UPDATE public.attendance_requests r
  SET status='rejected',
      review_note=left(concat_ws(' | ',nullif(r.review_note,''),'Auto-rejected: normal duty ended with early leave.'),1000),
      updated_at=now()
  WHERE r.request_type='overtime'
    AND r.status='approved'
    AND r.applied_session_id IS NULL
    AND EXISTS(
      SELECT 1
      FROM public.attendance_sessions s
      JOIN public.attendance_shifts sh ON sh.id=s.shift_id
      WHERE s.id=r.session_id
        AND s.session_kind='normal'
        AND s.clock_out_at IS NOT NULL
        AND (s.clock_out_at<sh.ends_at OR s.early_leave_minutes>0)
    );

  FOR v_s IN
    SELECT s.*
    FROM public.attendance_sessions s
    JOIN public.attendance_requests r ON r.id=s.overtime_request_id
    WHERE s.clock_out_at IS NULL AND s.session_kind='overtime'
      AND r.status='approved' AND r.approved_overtime_end_at IS NOT NULL
      AND r.approved_overtime_end_at<=now()
    ORDER BY r.approved_overtime_end_at,s.clock_in_at
    FOR UPDATE OF s SKIP LOCKED
  LOOP
    SELECT r.approved_overtime_end_at INTO v_end
    FROM public.attendance_requests r
    WHERE r.id=v_s.overtime_request_id AND r.status='approved';

    UPDATE public.attendance_sessions
    SET clock_out_at=v_end,clock_out_source='auto',
        clock_out_note='auto_closed_overtime_end',status='closed',updated_at=now()
    WHERE id=v_s.id AND clock_out_at IS NULL;

    IF FOUND THEN
      PERFORM public.attendance_recalculate_session(v_s.id);
      v_count:=v_count+1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_process_duty_end_and_overtime()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_process_duty_end_and_overtime()
  TO service_role;
