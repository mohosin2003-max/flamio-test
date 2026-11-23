-- FLAMIO ATTENDANCE MASTER — verified TEST function definitions
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.
CREATE OR REPLACE FUNCTION public.attendance_list_orphan_task_photo_paths(_limit integer DEFAULT 500)
 RETURNS TABLE(object_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT so.name::text
    FROM storage.objects AS so
   WHERE so.bucket_id = 'attendance-evidence'
     AND so.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/tasks/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
     AND so.created_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM public.attendance_tasks AS t WHERE t.photo_path = so.name
     )
   ORDER BY so.created_at ASC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 500), 1), 500);
$function$


CREATE OR REPLACE FUNCTION public.attendance_lock_task_checklist_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_task_id uuid;
  v_task_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'Checklist items cannot be moved between tasks';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_task_id := OLD.task_id;
  ELSE
    v_task_id := NEW.task_id;
  END IF;

  SELECT t.status INTO v_task_status
    FROM public.attendance_tasks AS t
   WHERE t.id = v_task_id
   FOR UPDATE;

  -- A parent-task deletion can cascade to checklist rows after the parent is
  -- no longer visible to this trigger; allow that cascade only.
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Parent task not found';
  END IF;

  IF v_task_status NOT IN ('pending', 'in_progress', 'rejected') THEN
    RAISE EXCEPTION 'Checklist cannot be changed after task closure';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_manager_correct_session(_session_id uuid, _clock_in_at timestamp with time zone, _clock_out_at timestamp with time zone, _reason text)
 RETURNS attendance_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  s public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _clock_in_at IS NULL THEN RAISE EXCEPTION 'Clock-in time is required'; END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF s.user_id = v_uid AND NOT public.has_role(v_uid, 'owner') THEN RAISE EXCEPTION 'You cannot correct your own attendance'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || s.user_id::text, 0));

  PERFORM public.attendance_apply_session_times(s.id, _clock_in_at, _clock_out_at, 'manager', _reason);
  PERFORM public.attendance_recalculate_session(s.id);
  SELECT * INTO s FROM public.attendance_sessions WHERE id = s.id;
  RETURN s;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_process_duty_end_and_overtime()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
$function$


CREATE OR REPLACE FUNCTION public.attendance_purge_old_records()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sessions integer := 0;
  v_tasks integer := 0;
begin
  delete from public.attendance_sessions s
   where s.clock_out_at is not null
     and s.clock_out_at < now() - interval '90 days'
     and s.status <> 'open'
     and s.status <> 'auto_closed'
     and s.verification_status <> 'disputed'
     and s.verification_status <> 'unverified';
  get diagnostics v_sessions = row_count;

  delete from public.attendance_tasks t
   where t.status in ('completed','verified','cancelled','rejected')
     and coalesce(t.completed_at, t.created_at) < now() - interval '90 days';
  get diagnostics v_tasks = row_count;

  return jsonb_build_object('sessions_deleted', v_sessions, 'tasks_deleted', v_tasks);
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_review_request(_request_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS attendance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
$function$


CREATE OR REPLACE FUNCTION public.attendance_review_request_as_service(_request_id uuid, _approve boolean, _note text, _actor_id uuid)
 RETURNS attendance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_request public.attendance_requests%ROWTYPE;
BEGIN
  IF _actor_id IS NULL
     OR NOT (
       public.has_role(_actor_id, 'owner'::public.app_role)
       OR public.has_role(_actor_id, 'admin'::public.app_role)
     )
  THEN
    RAISE EXCEPTION 'Only an Owner or Manager can review attendance requests';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', _actor_id::text, true);

  SELECT * INTO v_request
  FROM public.attendance_review_request(_request_id, _approve, _note);

  RETURN v_request;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_review_task(_task_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS attendance_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  t public.attendance_tasks%ROWTYPE;
  v_tasks_enabled boolean;
BEGIN
  SELECT tasks_enabled INTO v_tasks_enabled FROM public.attendance_settings WHERE id;
  IF COALESCE(v_tasks_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task module is currently disabled';
  END IF;
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  SELECT * INTO t FROM public.attendance_tasks WHERE id = _task_id FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'completed' THEN RAISE EXCEPTION 'Task is not awaiting review'; END IF;
  IF t.assigned_to = v_uid AND NOT public.has_role(v_uid, 'owner') THEN RAISE EXCEPTION 'You cannot review your own task'; END IF;
  UPDATE public.attendance_tasks
     SET status = CASE WHEN _approve THEN 'verified' ELSE 'rejected' END,
         verified_by = CASE WHEN _approve THEN v_uid END,
         verified_at = CASE WHEN _approve THEN now() END,
         completed_at = CASE WHEN _approve THEN completed_at END,
         review_note = NULLIF(btrim(_note), '')
   WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_run_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.attendance_settings%ROWTYPE;
  s record;
  v_closed integer := 0;
  v_missed integer := 0;
  v_out timestamptz;
BEGIN
  -- Defence in depth: EXECUTE is granted to service_role only (section 7).
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;

  FOR s IN
    SELECT se.id, se.clock_in_at, sh.ends_at,
           (SELECT max(b.started_at) FROM public.attendance_breaks b WHERE b.session_id = se.id) AS last_break_start
      FROM public.attendance_sessions se
      LEFT JOIN public.attendance_shifts sh ON sh.id = se.shift_id
     WHERE se.clock_out_at IS NULL
       AND now() - se.clock_in_at > make_interval(hours => cfg.max_session_hours)
     FOR UPDATE OF se
  LOOP
    -- Close at the shift end if known, otherwise at the max length. Never later.
    v_out := LEAST(COALESCE(s.ends_at, s.clock_in_at + make_interval(hours => cfg.max_session_hours)),
                   s.clock_in_at + make_interval(hours => cfg.max_session_hours));
    v_out := GREATEST(v_out, s.clock_in_at + interval '1 minute');
    -- Never close before a break began (that would create an invalid break).
    IF s.last_break_start IS NOT NULL AND s.last_break_start + interval '1 minute' > v_out THEN
      v_out := s.last_break_start + interval '1 minute';
    END IF;
    IF v_out - s.clock_in_at > interval '24 hours' OR v_out > now() THEN
      RAISE NOTICE 'attendance_run_maintenance: session % left open for manual correction', s.id;
      CONTINUE;
    END IF;
    UPDATE public.attendance_breaks SET ended_at = v_out, source = 'auto'
     WHERE session_id = s.id AND (ended_at IS NULL OR ended_at > v_out);
    UPDATE public.attendance_sessions
       SET clock_out_at = v_out, clock_out_source = 'auto', status = 'auto_closed'
     WHERE id = s.id;
    PERFORM public.attendance_recalculate_session(s.id);
    v_closed := v_closed + 1;
  END LOOP;

  UPDATE public.attendance_shifts sh SET status = 'missed'
   WHERE sh.status = 'scheduled' AND sh.ends_at < now()
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id);
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  UPDATE public.attendance_shifts sh SET status = 'completed'
   WHERE sh.status = 'in_progress'
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id AND x.clock_out_at IS NULL);

  RETURN jsonb_build_object('auto_closed', v_closed, 'missed', v_missed);
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_session_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Attendance owner cannot be changed';
    END IF;
    -- A verified session's times cannot change until a manager un-verifies it.
    IF OLD.verification_status = 'verified' AND NEW.verification_status = 'verified' AND (
         NEW.clock_in_at IS DISTINCT FROM OLD.clock_in_at OR
         NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at OR
         NEW.shift_id IS DISTINCT FROM OLD.shift_id OR
         NEW.duty_date IS DISTINCT FROM OLD.duty_date) THEN
      RAISE EXCEPTION 'Verified attendance is locked; un-verify it first';
    END IF;
  END IF;
  -- Verification fields may only be set by a manager (or the service role).
  IF (TG_OP = 'INSERT' AND NEW.verification_status <> 'unverified')
     OR (TG_OP = 'UPDATE' AND (NEW.verification_status IS DISTINCT FROM OLD.verification_status
                               OR NEW.verified_by IS DISTINCT FROM OLD.verified_by)) THEN
    IF auth.uid() IS NOT NULL AND NOT public.attendance_is_manager(auth.uid()) THEN
      RAISE EXCEPTION 'Only a manager can verify attendance';
    END IF;
    IF NEW.verified_by IS NOT NULL AND NEW.verified_by = NEW.user_id
       AND NOT public.has_role(NEW.user_id, 'owner') THEN
      RAISE EXCEPTION 'You cannot verify your own attendance';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$

