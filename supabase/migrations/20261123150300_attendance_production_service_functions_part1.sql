-- FLAMIO ATTENDANCE MASTER — verified TEST function definitions
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.
CREATE OR REPLACE FUNCTION public.attendance_apply_session_times(_session_id uuid, _in timestamp with time zone, _out timestamp with time zone, _source text, _note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.attendance_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  PERFORM public.attendance_assert_valid_window(s.user_id, s.id, _in, _out);

  IF EXISTS (SELECT 1 FROM public.attendance_breaks b
              WHERE b.session_id = s.id
                AND ((_out IS NOT NULL AND b.started_at >= _out)
                  OR (b.ended_at IS NOT NULL AND b.ended_at <= _in))) THEN
    RAISE EXCEPTION 'A break lies outside the corrected times; include it or ask for it to be removed';
  END IF;

  -- Session first, so attendance_break_guard validates against the new window.
  UPDATE public.attendance_sessions
     SET verification_status = 'unverified', verified_by = NULL, verified_at = NULL,
         clock_in_at = _in, clock_out_at = _out,
         clock_in_source = CASE WHEN _in IS DISTINCT FROM s.clock_in_at THEN _source ELSE clock_in_source END,
         clock_out_source = CASE WHEN _out IS NULL THEN NULL
                                 WHEN _out IS DISTINCT FROM s.clock_out_at THEN _source
                                 ELSE clock_out_source END,
         status = CASE WHEN _out IS NULL THEN 'open' ELSE 'corrected' END,
         verification_note = COALESCE(NULLIF(btrim(_note), ''), verification_note)
   WHERE id = s.id;

  -- Clip each break in a single statement so its CHECK is never violated.
  UPDATE public.attendance_breaks b
     SET started_at = GREATEST(b.started_at, _in),
         ended_at = CASE WHEN _out IS NULL THEN b.ended_at
                         ELSE LEAST(COALESCE(b.ended_at, _out), _out) END,
         source = 'correction'
   WHERE b.session_id = s.id
     AND (b.started_at < _in OR (_out IS NOT NULL AND (b.ended_at IS NULL OR b.ended_at > _out)));
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_row jsonb := COALESCE(v_new, v_old);
BEGIN
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN
    RETURN NEW;  -- no real change
  END IF;
  INSERT INTO public.attendance_audit_log (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_TABLE_NAME = 'attendance_settings' THEN NULL
         ELSE NULLIF(v_row->>'id','')::uuid END,
    TG_OP,
    auth.uid(),
    COALESCE(NULLIF(v_row->>'user_id',''), NULLIF(v_row->>'assigned_to',''))::uuid,
    v_old,
    v_new
  );
  RETURN COALESCE(NEW, OLD);
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_auto_close_stale_session(_user_id uuid, _max_session_hours integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_session public.attendance_sessions%rowtype;
  v_cutoff timestamptz;
  v_break_minutes integer := 0;
  v_worked_minutes integer := 0;
begin
  if _user_id is null or _max_session_hours is null or _max_session_hours < 1 or _max_session_hours > 24 then
    raise exception 'Invalid stale-session recovery arguments';
  end if;

  if auth.uid() is not null then
    raise exception 'This operation is only available to the trusted server';
  end if;

  select s.* into v_session
    from public.attendance_sessions s
   where s.user_id = _user_id
     and s.clock_out_at is null
     and s.session_kind = 'normal'
   order by s.clock_in_at desc
   limit 1
   for update;

  if not found then return false; end if;

  v_cutoff := v_session.clock_in_at + make_interval(hours => _max_session_hours);
  if now() < v_cutoff then return false; end if;

  update public.attendance_breaks b
     set ended_at = greatest(b.started_at, v_cutoff),
         updated_at = now()
   where b.session_id = v_session.id
     and b.user_id = _user_id
     and b.ended_at is null;

  select coalesce(sum(greatest(0, floor(extract(epoch from
    (least(coalesce(b.ended_at, v_cutoff), v_cutoff) - b.started_at))/60)::integer)),0)::integer
    into v_break_minutes
    from public.attendance_breaks b
   where b.session_id = v_session.id
     and b.user_id = _user_id
     and b.started_at < v_cutoff;

  v_worked_minutes := greatest(
    0,
    floor(extract(epoch from (v_cutoff - v_session.clock_in_at))/60)::integer - v_break_minutes
  );

  update public.attendance_sessions
     set clock_out_at = v_cutoff,
         clock_out_source = 'auto',
         clock_out_note = 'Auto-closed at max session limit; Owner review required',
         worked_minutes = v_worked_minutes,
         break_minutes = v_break_minutes,
         status = 'auto_closed',
         flags = array(select distinct flag from unnest(coalesce(flags, array[]::text[]) || array['missed_punch']::text[]) as flag),
         updated_at = now()
   where id = v_session.id
     and clock_out_at is null;

  return found;
end;
$function$


CREATE OR REPLACE FUNCTION public.attendance_break_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  s public.attendance_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.attendance_sessions WHERE id = NEW.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NEW.user_id <> s.user_id THEN RAISE EXCEPTION 'Break does not belong to this session'; END IF;
  IF NEW.started_at < s.clock_in_at THEN RAISE EXCEPTION 'Break cannot start before clock-in'; END IF;
  IF s.clock_out_at IS NOT NULL AND (NEW.ended_at IS NULL OR NEW.ended_at > s.clock_out_at) THEN
    RAISE EXCEPTION 'Break must end before clock-out';
  END IF;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_cancel_request(_request_id uuid)
 RETURNS attendance_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.attendance_requests%ROWTYPE;
BEGIN
  UPDATE public.attendance_requests SET status = 'cancelled'
   WHERE id = _request_id AND user_id = auth.uid() AND status = 'pending'
  RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found or already reviewed'; END IF;
  RETURN r;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_clear_expired_evidence_refs(_paths text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sessions integer := 0;
  v_tasks integer := 0;
BEGIN
  IF COALESCE(cardinality(_paths), 0) = 0 THEN
    RETURN jsonb_build_object('sessions_cleared', 0, 'tasks_cleared', 0);
  END IF;

  -- Fail closed: accept only the exact path shapes produced by the app
  -- for clock-in selfies or task-photo evidence.
  IF EXISTS (
    SELECT 1
    FROM unnest(_paths) AS supplied(path)
    WHERE supplied.path IS NULL
       OR supplied.path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/([0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg|tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg)$'
  ) THEN
    RAISE EXCEPTION 'Invalid attendance evidence path; no references were changed';
  END IF;

  UPDATE public.attendance_sessions AS s
     SET clock_in_selfie_path = NULL
   WHERE s.clock_in_selfie_path = ANY(_paths)
     AND s.clock_in_selfie_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
     AND s.clock_out_at IS NOT NULL
     AND s.clock_out_at < now() - interval '30 days'
     AND s.status <> 'open'
     AND s.status <> 'auto_closed'
     AND s.verification_status <> 'disputed'
     AND s.verification_status <> 'unverified';
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  UPDATE public.attendance_tasks AS t
     SET photo_path = NULL
   WHERE t.photo_path = ANY(_paths)
     AND t.photo_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
     AND t.status IN ('completed','verified','cancelled','rejected')
     AND COALESCE(t.completed_at, t.created_at) < now() - interval '30 days';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  RETURN jsonb_build_object('sessions_cleared', v_sessions, 'tasks_cleared', v_tasks);
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_complete_task_as_service(_actor_id uuid, _task_id uuid, _completion_note text DEFAULT NULL::text, _photo_path text DEFAULT NULL::text)
 RETURNS attendance_tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_old public.attendance_tasks%ROWTYPE;
  v_new public.attendance_tasks%ROWTYPE;
  v_undone_count integer;
  v_uploaded_at_ms bigint;
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_tasks_enabled boolean;
BEGIN
  SELECT tasks_enabled INTO v_tasks_enabled FROM public.attendance_settings WHERE id;
  IF COALESCE(v_tasks_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task module is currently disabled';
  END IF;
  IF NOT public.has_role(_actor_id, 'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff accounts can complete attendance tasks';
  END IF;
  SELECT t.* INTO v_old FROM public.attendance_tasks AS t WHERE t.id = _task_id FOR UPDATE;
  IF NOT FOUND OR v_old.assigned_to <> _actor_id THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;
  IF v_old.status NOT IN ('pending', 'in_progress', 'rejected') THEN
    RAISE EXCEPTION 'Task is already closed'; END IF;

  SELECT count(*) INTO v_undone_count FROM public.attendance_task_items AS i
   WHERE i.task_id = _task_id AND i.is_done IS DISTINCT FROM TRUE;
  IF v_undone_count > 0 THEN
    RAISE EXCEPTION 'All checklist items must be ticked before marking this task complete'; END IF;
  IF v_old.requires_photo AND (_photo_path IS NULL OR btrim(_photo_path) = '') THEN
    RAISE EXCEPTION 'Photo proof is required to complete this task'; END IF;
  IF _photo_path IS NOT NULL THEN
    IF _photo_path !~ ('^' || v_old.assigned_to::text || '/tasks/' || v_old.id::text ||
      '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') THEN
      RAISE EXCEPTION 'Photo proof path does not match this staff member and task'; END IF;
    v_uploaded_at_ms := substring(_photo_path FROM '/([0-9]{13})-[0-9a-f]{8}-')::bigint;
    IF v_uploaded_at_ms > v_now_ms + 60000 OR v_now_ms - v_uploaded_at_ms > 900000 THEN
      RAISE EXCEPTION 'Photo proof has expired or its upload timestamp is invalid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects AS so
      WHERE so.bucket_id = 'attendance-evidence' AND so.name = _photo_path) THEN
      RAISE EXCEPTION 'Photo proof object was not found'; END IF;
  END IF;

  UPDATE public.attendance_tasks
     SET status = 'completed', completed_at = now(),
         completion_note = NULLIF(btrim(_completion_note), ''),
         photo_path = _photo_path,
         review_note = CASE WHEN v_old.status = 'rejected' THEN NULL ELSE review_note END,
         updated_at = now()
   WHERE id = v_old.id
  RETURNING * INTO v_new;

  INSERT INTO public.attendance_audit_log
    (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES ('attendance_tasks', v_new.id, 'UPDATE', _actor_id, _actor_id, to_jsonb(v_old),
    to_jsonb(v_new) || jsonb_build_object('_attendance_event', 'staff_completed'));
  RETURN v_new;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_consume_qr_challenge(_token_hash text, _expected_station_id uuid)
 RETURNS TABLE(station_id uuid, challenge_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_station uuid;
  v_id uuid;
  cfg public.attendance_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;
  IF NOT FOUND OR cfg.attendance_enabled IS NOT TRUE OR cfg.qr_verification_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Attendance QR verification is currently disabled';
  END IF;
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid, 'staff'::public.app_role)
    OR public.has_role(v_uid, 'owner'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' OR _expected_station_id IS NULL THEN
    RAISE EXCEPTION 'Invalid QR token or station';
  END IF;

  UPDATE public.attendance_qr_challenges q
     SET consumed_at = now(), consumed_by = v_uid
   WHERE q.token_hash = _token_hash
     AND q.station_id = _expected_station_id
     AND q.consumed_at IS NULL
     AND q.expires_at > now()
   RETURNING q.station_id, q.id INTO v_station, v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'QR challenge is invalid, expired, already used, or belongs to another station';
  END IF;
  RETURN QUERY SELECT v_station, v_id;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_end_break_as_service(_actor_id uuid, _break_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_break public.attendance_breaks%ROWTYPE;
  v_session public.attendance_sessions%ROWTYPE;
  v_end timestamptz:=now();
  v_minutes integer;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id,'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff can end an attendance break';
  END IF;
  SELECT * INTO v_break FROM public.attendance_breaks
  WHERE id=_break_id AND user_id=_actor_id AND ended_at IS NULL FOR UPDATE;
  IF v_break.id IS NULL THEN RAISE EXCEPTION 'No active break was found'; END IF;
  SELECT * INTO v_session FROM public.attendance_sessions
  WHERE id=v_break.session_id AND user_id=_actor_id FOR UPDATE;
  IF v_session.id IS NULL THEN RAISE EXCEPTION 'Attendance session no longer exists'; END IF;
  IF v_session.clock_out_at IS NOT NULL THEN v_end:=LEAST(v_end,v_session.clock_out_at); END IF;
  IF v_end<=v_break.started_at THEN RAISE EXCEPTION 'Break end time is invalid'; END IF;
  v_minutes:=floor(extract(epoch FROM (v_end-v_break.started_at))/60);
  UPDATE public.attendance_breaks SET ended_at=v_end,source='app',updated_at=now() WHERE id=v_break.id;
  UPDATE public.attendance_sessions SET break_minutes=COALESCE(v_session.break_minutes,0)+v_minutes,updated_at=now() WHERE id=v_session.id;
  PERFORM public.attendance_recalculate_session(v_session.id);
  RETURN v_minutes;
END;
$function$


CREATE OR REPLACE FUNCTION public.attendance_list_expired_evidence_paths(_limit integer DEFAULT 500)
 RETURNS TABLE(object_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH expired_session_refs AS (
    SELECT s.clock_in_selfie_path AS path, so.created_at AS object_created_at
      FROM public.attendance_sessions AS s
      LEFT JOIN storage.objects AS so
        ON so.bucket_id = 'attendance-evidence'
       AND so.name = s.clock_in_selfie_path
     WHERE s.clock_in_selfie_path IS NOT NULL
       AND s.clock_in_selfie_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
       AND s.clock_out_at IS NOT NULL
       AND s.clock_out_at < now() - interval '30 days'
       AND s.status <> 'open'
       AND s.status <> 'auto_closed'
       AND s.verification_status <> 'disputed'
       AND s.verification_status <> 'unverified'
       AND (so.name IS NULL OR so.created_at < now() - interval '30 days')
  ),
  expired_task_refs AS (
    SELECT t.photo_path AS path, so.created_at AS object_created_at
      FROM public.attendance_tasks AS t
      LEFT JOIN storage.objects AS so
        ON so.bucket_id = 'attendance-evidence'
       AND so.name = t.photo_path
     WHERE t.photo_path IS NOT NULL
       AND t.photo_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
       AND t.status IN ('completed','verified','cancelled','rejected')
       AND COALESCE(t.completed_at, t.created_at) < now() - interval '30 days'
       AND (so.name IS NULL OR so.created_at < now() - interval '30 days')
  ),
  candidates AS (
    SELECT path FROM expired_session_refs
    UNION
    SELECT path FROM expired_task_refs
  )
  SELECT path
    FROM candidates
   ORDER BY path
   LIMIT LEAST(GREATEST(COALESCE(_limit, 500), 1), 500);
$function$

