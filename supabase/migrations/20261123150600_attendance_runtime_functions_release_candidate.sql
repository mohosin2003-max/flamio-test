-- FLAMIO ATTENDANCE MASTER — verified TEST function definitions
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.
CREATE OR REPLACE FUNCTION public.attendance_clock_in(_note text DEFAULT NULL::text, _source text DEFAULT 'app'::text)
 RETURNS attendance_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  cfg public.attendance_settings%ROWTYPE;
  v_shift uuid;
  v_date date;
  v_last timestamptz;
  r public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  IF _source NOT IN ('app','kiosk') THEN RAISE EXCEPTION 'Invalid source'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;
  IF NOT FOUND OR cfg.attendance_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Attendance module is currently disabled';
  END IF;

  IF EXISTS (SELECT 1 FROM public.attendance_sessions WHERE user_id = v_uid AND clock_out_at IS NULL) THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;

  SELECT max(clock_out_at) INTO v_last FROM public.attendance_sessions WHERE user_id = v_uid;
  IF v_last IS NOT NULL AND v_now - v_last < make_interval(secs => cfg.min_punch_gap_seconds) THEN
    RAISE EXCEPTION 'Please wait before clocking in again';
  END IF;

  v_shift := public.attendance_match_shift(v_uid, v_now);
  IF v_shift IS NULL AND NOT cfg.allow_unscheduled_clock_in THEN
    RAISE EXCEPTION 'No scheduled shift right now';
  END IF;
  IF v_shift IS NOT NULL THEN
    SELECT shift_date INTO v_date FROM public.attendance_shifts WHERE id = v_shift;
    UPDATE public.attendance_shifts SET status = 'in_progress' WHERE id = v_shift;
  ELSE
    v_date := public.attendance_local_date(v_now);
  END IF;

  INSERT INTO public.attendance_sessions (user_id, shift_id, duty_date, clock_in_at, clock_in_source, clock_in_note)
  VALUES (v_uid, v_shift, v_date, v_now, _source, NULLIF(btrim(_note), ''))
  RETURNING * INTO r;

  PERFORM public.attendance_recalculate_session(r.id);
  SELECT * INTO r FROM public.attendance_sessions WHERE id = r.id;
  RETURN r;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_end_break()
 RETURNS attendance_breaks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.attendance_breaks%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  UPDATE public.attendance_breaks b SET ended_at = GREATEST(now(), b.started_at + interval '1 second')
   WHERE b.user_id = v_uid AND b.ended_at IS NULL
  RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No break in progress'; END IF;
  PERFORM public.attendance_recalculate_session(r.session_id);
  RETURN r;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_team_directory()
 RETURNS TABLE(user_id uuid, full_name text, roles app_role[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ur.user_id, p.full_name, array_agg(ur.role ORDER BY ur.role)
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
   WHERE public.attendance_is_manager(auth.uid())
   GROUP BY ur.user_id, p.full_name;
$function$

