-- FLAMIO ATTENDANCE MASTER — TEST hardening
-- Target: TEST Supabase only (avwrptztixaketchgmsh)
-- Production is intentionally untouched.
-- Fail-closed while attendance/tasks are disabled for release preparation.

UPDATE public.attendance_settings
SET attendance_enabled = false,
    tasks_enabled = false;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.attendance_settings) > 1 THEN
    RAISE EXCEPTION 'attendance_settings must contain at most one row';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_settings_singleton_idx
  ON public.attendance_settings ((true));

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS table_name
    FROM pg_constraint
    WHERE conname IN (
      'attendance_shifts_user_id_fkey',
      'attendance_sessions_user_id_fkey',
      'attendance_breaks_user_id_fkey',
      'attendance_tasks_assigned_to_fkey',
      'attendance_requests_user_id_fkey',
      'attendance_location_events_user_id_fkey'
    )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.table_name, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.attendance_shifts
  ADD CONSTRAINT attendance_shifts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT attendance_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.attendance_breaks
  ADD CONSTRAINT attendance_breaks_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.attendance_tasks
  ADD CONSTRAINT attendance_tasks_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.attendance_requests
  ADD CONSTRAINT attendance_requests_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.attendance_location_events
  ADD CONSTRAINT attendance_location_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.attendance_clock_in(
  _note text DEFAULT NULL::text,
  _source text DEFAULT 'app'::text
)
RETURNS public.attendance_sessions
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
  INSERT INTO public.attendance_sessions
    (user_id, shift_id, duty_date, clock_in_at, clock_in_source, clock_in_note)
  VALUES
    (v_uid, v_shift, v_date, v_now, _source, NULLIF(btrim(_note), ''))
  RETURNING * INTO r;
  PERFORM public.attendance_recalculate_session(r.id);
  SELECT * INTO r FROM public.attendance_sessions WHERE id = r.id;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_start_break()
RETURNS public.attendance_breaks
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
  SELECT id INTO v_session
  FROM public.attendance_sessions
  WHERE user_id = v_uid AND clock_out_at IS NULL;
  IF v_session IS NULL THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.attendance_breaks
    WHERE session_id = v_session AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Break already started';
  END IF;
  INSERT INTO public.attendance_breaks (session_id, user_id, started_at)
  VALUES (v_session, v_uid, now())
  RETURNING * INTO r;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_consume_qr_challenge(
  _token_hash text,
  _expected_station_id uuid
)
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
  IF NOT FOUND
     OR cfg.attendance_enabled IS NOT TRUE
     OR cfg.qr_verification_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Attendance QR verification is currently disabled';
  END IF;
  IF v_uid IS NULL OR NOT (
    public.has_role(v_uid, 'staff'::public.app_role)
    OR public.has_role(v_uid, 'owner'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  IF _token_hash IS NULL
     OR _token_hash !~ '^[0-9a-f]{64}$'
     OR _expected_station_id IS NULL THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item(
  _item_id uuid,
  _done boolean
)
RETURNS public.attendance_task_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  i public.attendance_task_items%ROWTYPE;
  cfg public.attendance_settings%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;
  IF NOT FOUND
     OR cfg.attendance_enabled IS NOT TRUE
     OR cfg.tasks_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Task module is currently disabled';
  END IF;
  SELECT it.* INTO i
  FROM public.attendance_task_items it
  JOIN public.attendance_tasks t ON t.id = it.task_id
  WHERE it.id = _item_id
    AND t.assigned_to = v_uid
    AND t.status IN ('pending','in_progress','rejected')
  FOR UPDATE OF it;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Checklist item not found'; END IF;
  UPDATE public.attendance_task_items
  SET is_done = _done,
      done_at = CASE WHEN _done THEN now() END,
      done_by = CASE WHEN _done THEN v_uid END
  WHERE id = i.id
  RETURNING * INTO i;
  RETURN i;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item_as_service(
  _actor_id uuid,
  _item_id uuid,
  _done boolean
)
RETURNS public.attendance_task_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_task public.attendance_tasks%ROWTYPE;
  v_old public.attendance_task_items%ROWTYPE;
  v_new public.attendance_task_items%ROWTYPE;
  v_tasks_enabled boolean;
BEGIN
  SELECT tasks_enabled INTO v_tasks_enabled FROM public.attendance_settings WHERE id;
  IF COALESCE(v_tasks_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Task module is currently disabled';
  END IF;
  IF NOT public.has_role(_actor_id, 'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff accounts can update checklist items';
  END IF;
  SELECT t.* INTO v_task
  FROM public.attendance_tasks AS t
  JOIN public.attendance_task_items AS i ON i.task_id = t.id
  WHERE i.id = _item_id
  FOR UPDATE OF t;
  IF NOT FOUND OR v_task.assigned_to <> _actor_id THEN
    RAISE EXCEPTION 'Checklist item not found or access denied';
  END IF;
  IF v_task.status NOT IN ('pending', 'in_progress', 'rejected') THEN
    RAISE EXCEPTION 'This task is already closed';
  END IF;
  SELECT i.* INTO v_old FROM public.attendance_task_items AS i
  WHERE i.id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item not found'; END IF;
  UPDATE public.attendance_task_items
  SET is_done = _done,
      done_at = CASE WHEN _done THEN now() ELSE NULL END,
      done_by = CASE WHEN _done THEN _actor_id ELSE NULL END
  WHERE id = _item_id
  RETURNING * INTO v_new;
  INSERT INTO public.attendance_audit_log
    (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES
    ('attendance_task_items', v_new.id, 'UPDATE', _actor_id, _actor_id,
     to_jsonb(v_old),
     to_jsonb(v_new) || jsonb_build_object(
       '_attendance_event', CASE WHEN _done THEN 'checklist_item_done' ELSE 'checklist_item_reopened' END
     ));
  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_complete_task_as_service(
  _actor_id uuid,
  _task_id uuid,
  _completion_note text DEFAULT NULL::text,
  _photo_path text DEFAULT NULL::text
)
RETURNS public.attendance_tasks
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
  SELECT t.* INTO v_old FROM public.attendance_tasks AS t
  WHERE t.id = _task_id FOR UPDATE;
  IF NOT FOUND OR v_old.assigned_to <> _actor_id THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;
  IF v_old.status NOT IN ('pending', 'in_progress', 'rejected') THEN
    RAISE EXCEPTION 'Task is already closed';
  END IF;
  SELECT count(*) INTO v_undone_count
  FROM public.attendance_task_items AS i
  WHERE i.task_id = _task_id AND i.is_done IS DISTINCT FROM TRUE;
  IF v_undone_count > 0 THEN
    RAISE EXCEPTION 'All checklist items must be ticked before marking this task complete';
  END IF;
  IF v_old.requires_photo AND (_photo_path IS NULL OR btrim(_photo_path) = '') THEN
    RAISE EXCEPTION 'Photo proof is required to complete this task';
  END IF;
  IF _photo_path IS NOT NULL THEN
    IF _photo_path !~ ('^' || v_old.assigned_to::text || '/tasks/' || v_old.id::text ||
      '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') THEN
      RAISE EXCEPTION 'Photo proof path does not match this staff member and task';
    END IF;
    v_uploaded_at_ms := substring(_photo_path FROM '/([0-9]{13})-[0-9a-f]{8}-')::bigint;
    IF v_uploaded_at_ms > v_now_ms + 60000 OR v_now_ms - v_uploaded_at_ms > 900000 THEN
      RAISE EXCEPTION 'Photo proof has expired or its upload timestamp is invalid';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects AS so
      WHERE so.bucket_id = 'attendance-evidence' AND so.name = _photo_path
    ) THEN
      RAISE EXCEPTION 'Photo proof object was not found';
    END IF;
  END IF;
  UPDATE public.attendance_tasks
  SET status = 'completed',
      completed_at = now(),
      completion_note = NULLIF(btrim(_completion_note), ''),
      photo_path = _photo_path,
      review_note = CASE WHEN v_old.status = 'rejected' THEN NULL ELSE review_note END,
      updated_at = now()
  WHERE id = v_old.id
  RETURNING * INTO v_new;
  INSERT INTO public.attendance_audit_log
    (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES ('attendance_tasks', v_new.id, 'UPDATE', _actor_id, _actor_id,
    to_jsonb(v_old), to_jsonb(v_new) || jsonb_build_object('_attendance_event', 'staff_completed'));
  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_update_task_progress(
  _task_id uuid,
  _status text,
  _note text DEFAULT NULL::text
)
RETURNS public.attendance_tasks
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
  IF _status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO t FROM public.attendance_tasks WHERE id = _task_id FOR UPDATE;
  IF t.id IS NULL OR t.assigned_to <> v_uid THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.status NOT IN ('pending','in_progress','rejected') THEN RAISE EXCEPTION 'Task can no longer be changed'; END IF;
  UPDATE public.attendance_tasks
  SET status = _status,
      started_at = COALESCE(started_at, now()),
      completed_at = CASE WHEN _status = 'completed' THEN now() ELSE NULL END,
      completion_note = CASE WHEN _status = 'completed' THEN NULLIF(btrim(_note), '') ELSE completion_note END,
      review_note = CASE WHEN t.status = 'rejected' THEN NULL ELSE review_note END
  WHERE id = t.id
  RETURNING * INTO t;
  RETURN t;
END;
$function$;

CREATE OR REPLACE FUNCTION public.attendance_review_task(
  _task_id uuid,
  _approve boolean,
  _note text DEFAULT NULL::text
)
RETURNS public.attendance_tasks
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
$function$;

CREATE OR REPLACE FUNCTION public.attendance_verify_session(
  _session_id uuid,
  _status text,
  _note text DEFAULT NULL::text
)
RETURNS public.attendance_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  s public.attendance_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.attendance_is_manager(v_uid) THEN
    RAISE EXCEPTION 'Managers only';
  END IF;
  IF _status IS NULL OR _status NOT IN ('verified', 'disputed', 'unverified') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF s.user_id = v_uid THEN RAISE EXCEPTION 'You cannot review your own attendance'; END IF;
  IF _status = 'verified' AND s.clock_out_at IS NULL THEN
    RAISE EXCEPTION 'Cannot verify an open session';
  END IF;
  UPDATE public.attendance_sessions
  SET verification_status = _status,
      verified_by = CASE WHEN _status = 'verified' THEN v_uid ELSE NULL END,
      verified_at = CASE WHEN _status = 'verified' THEN now() ELSE NULL END,
      verification_note = NULLIF(btrim(_note), '')
  WHERE id = s.id
  RETURNING * INTO s;
  RETURN s;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.attendance_clock_in(text,text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_start_break() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text,uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_toggle_task_item(uuid,boolean) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_toggle_task_item_as_service(uuid,uuid,boolean) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_complete_task_as_service(uuid,uuid,text,text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_update_task_progress(uuid,text,text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_review_task(uuid,boolean,text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.attendance_verify_session(uuid,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session(uuid,text,text) TO authenticated;

UPDATE storage.buckets
SET public = false,
    file_size_limit = 1500000,
    allowed_mime_types = ARRAY['image/jpeg']::text[]
WHERE id = 'attendance-evidence';

DO $policies$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='attendance_evidence_member_upload_own'
  ) THEN
    CREATE POLICY attendance_evidence_member_upload_own ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id='attendance-evidence'
        AND public.attendance_is_member(auth.uid())
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='attendance_evidence_member_read_own'
  ) THEN
    CREATE POLICY attendance_evidence_member_read_own ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id='attendance-evidence'
        AND public.attendance_is_member(auth.uid())
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END;
$policies$;
