-- FLAMIO ATTENDANCE MASTER — verified TEST function definitions
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.
CREATE OR REPLACE FUNCTION public.attendance_shift_compute()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.is_overnight := NEW.end_time <= NEW.start_time;
  NEW.starts_at := (NEW.shift_date + NEW.start_time) AT TIME ZONE 'Asia/Dhaka';
  NEW.ends_at := ((NEW.shift_date + CASE WHEN NEW.is_overnight THEN 1 ELSE 0 END) + NEW.end_time) AT TIME ZONE 'Asia/Dhaka';
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item(_item_id uuid, _done boolean)
 RETURNS attendance_task_items
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
  IF NOT FOUND OR cfg.attendance_enabled IS NOT TRUE OR cfg.tasks_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'Task module is currently disabled';
  END IF;
  SELECT it.* INTO i FROM public.attendance_task_items it
    JOIN public.attendance_tasks t ON t.id = it.task_id
   WHERE it.id = _item_id AND t.assigned_to = v_uid AND t.status IN ('pending','in_progress','rejected')
   FOR UPDATE OF it;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Checklist item not found'; END IF;
  UPDATE public.attendance_task_items
     SET is_done = _done, done_at = CASE WHEN _done THEN now() END, done_by = CASE WHEN _done THEN v_uid END
   WHERE id = i.id RETURNING * INTO i;
  RETURN i;
END;
$function$;


CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item_as_service(_actor_id uuid, _item_id uuid, _done boolean)
 RETURNS attendance_task_items
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


CREATE OR REPLACE FUNCTION public.attendance_update_task_progress(_task_id uuid, _status text, _note text DEFAULT NULL::text)
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


CREATE OR REPLACE FUNCTION public.attendance_validate_request_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.attendance_sessions%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM public.attendance_sessions
    WHERE id=NEW.session_id FOR SHARE;
    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'Referenced attendance session does not exist';
    END IF;
    IF v_session.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'Attendance request session does not belong to the requester';
    END IF;
  END IF;

  IF NEW.requested_clock_in IS NOT NULL THEN
    IF NEW.requested_clock_in > v_now THEN RAISE EXCEPTION 'Requested clock-in cannot be in the future'; END IF;
    IF NEW.requested_clock_in < v_now - interval '31 days' THEN RAISE EXCEPTION 'Requested clock-in is too old'; END IF;
  END IF;
  IF NEW.requested_clock_out IS NOT NULL THEN
    IF NEW.requested_clock_out > v_now THEN RAISE EXCEPTION 'Requested clock-out cannot be in the future'; END IF;
    IF NEW.requested_clock_out < v_now - interval '31 days' THEN RAISE EXCEPTION 'Requested clock-out is too old'; END IF;
  END IF;
  IF NEW.requested_clock_in IS NOT NULL AND NEW.requested_clock_out IS NOT NULL THEN
    IF NEW.requested_clock_out <= NEW.requested_clock_in THEN RAISE EXCEPTION 'Requested clock-out must be after clock-in'; END IF;
    IF NEW.requested_clock_out - NEW.requested_clock_in > interval '24 hours' THEN RAISE EXCEPTION 'Requested attendance window cannot exceed 24 hours'; END IF;
  END IF;
  IF NEW.request_type='missed_punch'
     AND NEW.target_date IS NOT NULL
     AND NEW.requested_clock_in IS NOT NULL
     AND (NEW.requested_clock_in AT TIME ZONE 'Asia/Dhaka')::date <> NEW.target_date THEN
    RAISE EXCEPTION 'Missed-punch date does not match requested clock-in date';
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.attendance_verify_session(_session_id uuid, _status text, _note text DEFAULT NULL::text)
 RETURNS attendance_sessions
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

SELECT *
INTO s
FROM public.attendance_sessions
WHERE id = _session_id
FOR UPDATE;

IF s.id IS NULL THEN
RAISE EXCEPTION 'Session not found';
END IF;

IF s.user_id = v_uid THEN
RAISE EXCEPTION 'You cannot review your own attendance';
END IF;

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


CREATE OR REPLACE FUNCTION public.attendance_verify_session_as_service(_session_id uuid, _status text, _note text, _actor_id uuid)
 RETURNS attendance_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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


CREATE OR REPLACE FUNCTION public.attendance_verify_task_photo_cleanup_secret(_provided_secret text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'attendance_task_photo_cleanup_secret'
       AND decrypted_secret = _provided_secret
  ), false);
$function$

