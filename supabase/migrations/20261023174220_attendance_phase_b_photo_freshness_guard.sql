-- FLAMIO ATTENDANCE MASTER — TEST-only photo freshness guard.
-- Applied to TEST project avwrptztixaketchgmsh as migration 20261023174220.
CREATE OR REPLACE FUNCTION public.attendance_complete_task_as_service(
  _actor_id uuid, _task_id uuid, _completion_note text DEFAULT NULL, _photo_path text DEFAULT NULL
)
RETURNS public.attendance_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old public.attendance_tasks%ROWTYPE;
  v_new public.attendance_tasks%ROWTYPE;
  v_undone_count integer;
  v_uploaded_at_ms bigint;
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF NOT public.has_role(_actor_id, 'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff accounts can complete attendance tasks';
  END IF;
  SELECT t.* INTO v_old FROM public.attendance_tasks AS t WHERE t.id = _task_id FOR UPDATE;
  IF NOT FOUND OR v_old.assigned_to <> _actor_id THEN RAISE EXCEPTION 'Task not found or access denied'; END IF;
  IF v_old.status NOT IN ('pending', 'in_progress', 'rejected') THEN RAISE EXCEPTION 'Task is already closed'; END IF;
  SELECT count(*) INTO v_undone_count FROM public.attendance_task_items AS i
   WHERE i.task_id = _task_id AND i.is_done IS DISTINCT FROM TRUE;
  IF v_undone_count > 0 THEN RAISE EXCEPTION 'All checklist items must be ticked before marking this task complete'; END IF;
  IF v_old.requires_photo AND (_photo_path IS NULL OR btrim(_photo_path) = '') THEN RAISE EXCEPTION 'Photo proof is required to complete this task'; END IF;
  IF _photo_path IS NOT NULL THEN
    IF _photo_path !~ ('^' || v_old.assigned_to::text || '/tasks/' || v_old.id::text || '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') THEN
      RAISE EXCEPTION 'Photo proof path does not match this staff member and task';
    END IF;
    v_uploaded_at_ms := substring(_photo_path FROM '/([0-9]{13})-[0-9a-f]{8}-')::bigint;
    IF v_uploaded_at_ms > v_now_ms + 60000 OR v_now_ms - v_uploaded_at_ms > 900000 THEN
      RAISE EXCEPTION 'Photo proof has expired or its upload timestamp is invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects AS so WHERE so.bucket_id = 'attendance-evidence' AND so.name = _photo_path) THEN
      RAISE EXCEPTION 'Photo proof object was not found';
    END IF;
  END IF;
  UPDATE public.attendance_tasks
     SET status = 'completed', completed_at = now(),
         completion_note = NULLIF(btrim(_completion_note), ''), photo_path = _photo_path,
         review_note = CASE WHEN v_old.status = 'rejected' THEN NULL ELSE review_note END,
         updated_at = now()
   WHERE id = v_old.id RETURNING * INTO v_new;
  INSERT INTO public.attendance_audit_log (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES ('attendance_tasks', v_new.id, 'UPDATE', _actor_id, _actor_id, to_jsonb(v_old),
    to_jsonb(v_new) || jsonb_build_object('_attendance_event', 'staff_completed'));
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_complete_task_as_service(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_complete_task_as_service(uuid, uuid, text, text) TO service_role;
