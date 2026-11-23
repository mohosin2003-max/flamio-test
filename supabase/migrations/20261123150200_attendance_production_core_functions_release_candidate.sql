-- FLAMIO ATTENDANCE MASTER — verified TEST function definitions (core)
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.
-- Generated directly from TEST project avwrptztixaketchgmsh.

CREATE OR REPLACE FUNCTION public.attendance_is_member(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (auth.uid() IS NULL OR _user_id = auth.uid() OR EXISTS (
           SELECT 1 FROM public.user_roles c
            WHERE c.user_id = auth.uid() AND c.role IN ('owner'::public.app_role, 'admin'::public.app_role)))
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id);
$function$;


CREATE OR REPLACE FUNCTION public.attendance_is_manager(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _user_id IS NOT NULL
     AND (auth.uid() IS NULL OR _user_id = auth.uid() OR EXISTS (
           SELECT 1 FROM public.user_roles c
            WHERE c.user_id = auth.uid() AND c.role IN ('owner'::public.app_role, 'admin'::public.app_role)))
     AND EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id AND role IN ('owner'::public.app_role, 'admin'::public.app_role));
$function$


CREATE OR REPLACE FUNCTION public.attendance_minutes(_from timestamp with time zone, _to timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN _from IS NULL OR _to IS NULL OR _to <= _from THEN 0
              ELSE floor(extract(epoch FROM (_to - _from)) / 60)::integer END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_match_shift(_user_id uuid, _at timestamp with time zone)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT sh.id
    FROM public.attendance_shifts sh, public.attendance_settings cfg
   WHERE cfg.id
     AND sh.user_id = _user_id
     AND sh.status IN ('scheduled','in_progress','missed')
     AND _at >= sh.starts_at - make_interval(mins => cfg.early_clock_in_minutes)
     AND _at <  sh.ends_at
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id)
   ORDER BY abs(extract(epoch FROM (_at - sh.starts_at)))
   LIMIT 1;
$function$


CREATE OR REPLACE FUNCTION public.attendance_assert_valid_window(_user_id uuid, _exclude_session uuid, _in timestamp with time zone, _out timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _in IS NULL THEN RAISE EXCEPTION 'Clock-in time is required'; END IF;
  IF _in > now() OR _out > now() THEN RAISE EXCEPTION 'Times cannot be in the future'; END IF;
  IF _in < now() - interval '31 days' THEN RAISE EXCEPTION 'Corrections are limited to the last 31 days'; END IF;
  IF _out IS NOT NULL AND _out <= _in THEN RAISE EXCEPTION 'Clock-out must be after clock-in'; END IF;
  IF _out IS NOT NULL AND _out - _in > interval '24 hours' THEN RAISE EXCEPTION 'A session cannot exceed 24 hours'; END IF;
  IF _out IS NULL AND now() - _in > interval '24 hours' THEN RAISE EXCEPTION 'An open session cannot be older than 24 hours'; END IF;
  IF EXISTS (
      SELECT 1 FROM public.attendance_sessions x
       WHERE x.user_id = _user_id
         AND x.id IS DISTINCT FROM _exclude_session
         AND tstzrange(x.clock_in_at, COALESCE(x.clock_out_at, 'infinity'::timestamptz), '[)')
          && tstzrange(_in, COALESCE(_out, 'infinity'::timestamptz), '[)')) THEN
    RAISE EXCEPTION 'These times overlap another attendance session';
  END IF;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_recalculate_session(_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_s public.attendance_sessions%ROWTYPE;
  v_sh public.attendance_shifts%ROWTYPE;
  v_cfg public.attendance_settings%ROWTYPE;
  v_end timestamptz;
  v_break integer := 0;
  v_worked integer := 0;
  v_late integer := 0;
  v_early integer := 0;
  v_ot integer := 0;
  v_flags text[] := ARRAY[]::text[];
  v_approved_duration integer;
BEGIN
  SELECT * INTO v_s
  FROM public.attendance_sessions
  WHERE id = _session_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_cfg FROM public.attendance_settings WHERE id;
  v_end := COALESCE(v_s.clock_out_at, now());

  SELECT COALESCE(
    SUM(public.attendance_minutes(
      GREATEST(b.started_at, v_s.clock_in_at),
      LEAST(COALESCE(b.ended_at, v_end), v_end)
    )), 0
  )
  INTO v_break
  FROM public.attendance_breaks b
  WHERE b.session_id = v_s.id
    AND b.started_at < v_end;

  v_worked := GREATEST(
    public.attendance_minutes(v_s.clock_in_at, v_end) - v_break,
    0
  );

  IF v_s.session_kind = 'overtime' THEN
    SELECT r.requested_overtime_minutes
      INTO v_approved_duration
      FROM public.attendance_requests r
     WHERE r.id = v_s.overtime_request_id
       AND r.request_type = 'overtime'
       AND r.status = 'approved';

    v_ot := CASE
      WHEN v_approved_duration IS NULL THEN 0
      ELSE LEAST(v_worked, v_approved_duration)
    END;

    v_flags := array_append(v_flags, 'overtime');

    IF v_s.status = 'auto_closed' THEN
      v_flags := array_append(v_flags, 'auto_closed');
    END IF;
  ELSE
    IF v_s.shift_id IS NOT NULL THEN
      SELECT * INTO v_sh
      FROM public.attendance_shifts
      WHERE id = v_s.shift_id;
    END IF;

    IF v_sh.id IS NOT NULL THEN
      IF public.attendance_minutes(v_sh.starts_at, v_s.clock_in_at) > v_cfg.late_grace_minutes THEN
        v_late := public.attendance_minutes(v_sh.starts_at, v_s.clock_in_at);
        v_flags := array_append(v_flags, 'late');
      END IF;

      IF v_s.clock_out_at IS NOT NULL THEN
        v_early := GREATEST(
          public.attendance_minutes(v_s.clock_out_at, v_sh.ends_at),
          0
        );
        IF v_early > 0 THEN
          v_flags := array_append(v_flags, 'early_leave');
        END IF;
      END IF;
    ELSE
      v_flags := array_append(v_flags, 'unscheduled');
    END IF;

    -- Normal duty never earns overtime merely because a clock-out was missed.
    v_ot := 0;

    IF v_s.status = 'auto_closed' THEN
      v_flags := array_append(v_flags, 'auto_closed');
    END IF;
    IF v_s.status = 'corrected' THEN
      v_flags := array_append(v_flags, 'corrected');
    END IF;
  END IF;

  IF v_s.session_kind = 'normal'
     AND public.attendance_minutes(v_s.clock_in_at, v_end) > v_cfg.max_session_hours * 60 THEN
    v_flags := array_append(v_flags, 'long_session');
  END IF;

  SELECT ARRAY(
    SELECT DISTINCT x
    FROM unnest(v_flags) AS x
    ORDER BY x
  )
  INTO v_flags;

  UPDATE public.attendance_sessions
     SET break_minutes = v_break,
         worked_minutes = v_worked,
         late_minutes = v_late,
         early_leave_minutes = v_early,
         overtime_minutes = v_ot,
         flags = COALESCE(v_flags, ARRAY[]::text[]),
         updated_at = now()
   WHERE id = v_s.id;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_clock_out(_note text DEFAULT NULL::text, _source text DEFAULT 'app'::text)
 RETURNS attendance_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  cfg public.attendance_settings%rowtype;
  r public.attendance_sessions%rowtype;
  v_out timestamptz;
  v_shift_end timestamptz;
begin
  if not public.attendance_is_member(v_uid) then raise exception 'Not a team member'; end if;
  if _source not in ('app','kiosk') then raise exception 'Invalid source'; end if;

  perform pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  select * into cfg from public.attendance_settings where id;

  select * into r
    from public.attendance_sessions
   where user_id = v_uid and clock_out_at is null
   order by clock_in_at desc
   limit 1
   for update;

  if r.id is null then raise exception 'You are not clocked in'; end if;

  if r.session_kind = 'overtime' then
    raise exception 'Approved overtime closes automatically. Manual clock-out is not allowed during overtime.';
  end if;

  if v_now - r.clock_in_at < make_interval(secs => cfg.min_punch_gap_seconds) then
    raise exception 'You just clocked in; please wait before clocking out';
  end if;

  if v_now - r.clock_in_at > interval '24 hours' then
    raise exception 'This session is too old to close; submit a correction request';
  end if;

  if r.shift_id is not null then
    select ends_at into v_shift_end from public.attendance_shifts where id = r.shift_id;
  end if;

  v_out := least(v_now, coalesce(v_shift_end, v_now));

  update public.attendance_breaks
     set ended_at = greatest(v_out, started_at + interval '1 second'),
         source = 'auto',
         updated_at = now()
   where session_id = r.id
     and ended_at is null;

  select max(ended_at) into v_out
    from public.attendance_breaks
   where session_id = r.id;

  v_out := least(coalesce(v_out, least(v_now, coalesce(v_shift_end, v_now))),
                 coalesce(v_shift_end, v_now));

  if v_out <= r.clock_in_at then
    raise exception 'Clock-out time must be after clock-in time';
  end if;

  update public.attendance_sessions
     set clock_out_at = v_out,
         clock_out_source = case when v_shift_end is not null and v_out = v_shift_end and v_now > v_shift_end then 'auto' else _source end,
         clock_out_note = case when v_shift_end is not null and v_out = v_shift_end and v_now > v_shift_end
                               then 'auto_closed_normal_duty_end'
                               else nullif(btrim(_note), '') end,
         status = case when v_shift_end is not null and v_out = v_shift_end and v_now > v_shift_end
                       then 'auto_closed' else 'closed' end
   where id = r.id;

  if r.shift_id is not null then
    update public.attendance_shifts
       set status = 'completed'
     where id = r.shift_id and status = 'in_progress';
  end if;

  perform public.attendance_recalculate_session(r.id);
  select * into r from public.attendance_sessions where id = r.id;
  return r;
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_start_break()
 RETURNS attendance_breaks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  cfg public.attendance_settings%ROWTYPE;
  r public.attendance_breaks%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;
  IF NOT FOUND OR cfg.attendance_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Attendance module is currently disabled';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  SELECT id INTO v_session FROM public.attendance_sessions WHERE user_id = v_uid AND clock_out_at IS NULL;
  IF v_session IS NULL THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_breaks WHERE session_id = v_session AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Break already started'; END IF;
  INSERT INTO public.attendance_breaks (session_id, user_id, started_at) VALUES (v_session, v_uid, now())
  RETURNING * INTO r;
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


CREATE OR REPLACE FUNCTION public.attendance_submit_request(_request_type text, _reason text, _leave_type text DEFAULT NULL::text, _leave_start_date date DEFAULT NULL::date, _leave_end_date date DEFAULT NULL::date, _session_id uuid DEFAULT NULL::uuid, _target_date date DEFAULT NULL::date, _requested_clock_in timestamp with time zone DEFAULT NULL::timestamp with time zone, _requested_clock_out timestamp with time zone DEFAULT NULL::timestamp with time zone, _requested_overtime_minutes integer DEFAULT NULL::integer)
 RETURNS attendance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r public.attendance_requests%ROWTYPE;
  v_shift_id uuid;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN
    RAISE EXCEPTION 'Not a team member';
  END IF;

  IF _request_type IS NULL
     OR _request_type NOT IN ('leave','missed_punch','correction','overtime') THEN
    RAISE EXCEPTION 'Invalid request type';
  END IF;

  IF _session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attendance_sessions
    WHERE id = _session_id AND user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  IF _requested_clock_in > now() OR _requested_clock_out > now() THEN
    RAISE EXCEPTION 'Requested times cannot be in the future';
  END IF;

  IF _request_type = 'overtime' THEN
    IF _session_id IS NULL OR _requested_overtime_minutes NOT IN (30,60,90,120) THEN
      RAISE EXCEPTION 'Overtime duration must be 30, 60, 90, or 120 minutes and a session is required';
    END IF;

    SELECT shift_id INTO v_shift_id
    FROM public.attendance_sessions
    WHERE id = _session_id
      AND user_id = v_uid;

    IF v_shift_id IS NULL THEN
      RAISE EXCEPTION 'Overtime requires a scheduled shift session';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.attendance_requests
      WHERE user_id = v_uid
        AND request_type = 'overtime'
        AND session_id = _session_id
        AND status IN ('pending','approved')
    ) THEN
      RAISE EXCEPTION 'An overtime request already exists for this attendance session';
    END IF;

    _target_date := COALESCE(
      _target_date,
      (SELECT duty_date FROM public.attendance_sessions WHERE id = _session_id)
    );
  ELSIF _request_type = 'missed_punch' THEN
    IF _requested_clock_in IS NULL OR _requested_clock_out IS NULL THEN
      RAISE EXCEPTION 'A missed punch needs both clock-in and clock-out';
    END IF;
    PERFORM public.attendance_assert_valid_window(
      v_uid, NULL, _requested_clock_in, _requested_clock_out
    );
    _target_date := public.attendance_local_date(_requested_clock_in);
  ELSIF _request_type = 'correction' AND _session_id IS NOT NULL THEN
    PERFORM public.attendance_assert_valid_window(
      v_uid,
      _session_id,
      COALESCE(
        _requested_clock_in,
        (SELECT clock_in_at FROM public.attendance_sessions WHERE id = _session_id)
      ),
      COALESCE(
        _requested_clock_out,
        (SELECT clock_out_at FROM public.attendance_sessions WHERE id = _session_id)
      )
    );
  ELSIF _request_type = 'leave'
    AND (_leave_start_date IS NULL OR _leave_end_date IS NULL) THEN
    RAISE EXCEPTION 'Leave start and end dates are required';
  END IF;

  IF _request_type = 'leave' AND EXISTS (
    SELECT 1
    FROM public.attendance_requests
    WHERE user_id = v_uid
      AND request_type = 'leave'
      AND status IN ('pending','approved')
      AND daterange(leave_start_date, leave_end_date, '[]')
          && daterange(_leave_start_date, _leave_end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'You already have leave for these dates';
  END IF;

  INSERT INTO public.attendance_requests (
    user_id, request_type, leave_type, leave_start_date, leave_end_date,
    session_id, target_date, requested_clock_in, requested_clock_out,
    requested_overtime_minutes, reason
  )
  VALUES (
    v_uid, _request_type, _leave_type, _leave_start_date, _leave_end_date,
    _session_id, COALESCE(
      _target_date,
      (SELECT duty_date FROM public.attendance_sessions WHERE id = _session_id)
    ),
    _requested_clock_in, _requested_clock_out,
    _requested_overtime_minutes, btrim(_reason)
  )
  RETURNING * INTO r;

  RETURN r;
END;
$function$

