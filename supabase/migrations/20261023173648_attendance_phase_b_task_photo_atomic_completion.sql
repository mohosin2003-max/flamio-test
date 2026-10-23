-- FLAMIO ATTENDANCE MASTER — Phase B task photo evidence and atomic checklist completion.
-- Target: TEST project avwrptztixaketchgmsh only. Never apply to Production without a separate review.

ALTER TABLE public.attendance_tasks
  ADD COLUMN IF NOT EXISTS requires_photo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_path text;

ALTER TABLE public.attendance_tasks
  DROP CONSTRAINT IF EXISTS attendance_tasks_photo_path_format_chk;
ALTER TABLE public.attendance_tasks
  ADD CONSTRAINT attendance_tasks_photo_path_format_chk
  CHECK (
    photo_path IS NULL OR
    photo_path ~ (
      '^' || assigned_to::text || '/tasks/' || id::text ||
      '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS attendance_tasks_photo_path_uq
  ON public.attendance_tasks(photo_path)
  WHERE photo_path IS NOT NULL;

CREATE OR REPLACE FUNCTION public.attendance_lock_task_checklist_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_task_id uuid;
  v_task_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'Checklist items cannot be moved between tasks';
  END IF;
  IF TG_OP = 'DELETE' THEN v_task_id := OLD.task_id; ELSE v_task_id := NEW.task_id; END IF;

  SELECT t.status INTO v_task_status
    FROM public.attendance_tasks AS t
   WHERE t.id = v_task_id
   FOR UPDATE;

  -- Permit child cleanup initiated by a parent-task delete cascade only.
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
$$;

DROP TRIGGER IF EXISTS attendance_task_items_lock_parent ON public.attendance_task_items;
CREATE TRIGGER attendance_task_items_lock_parent
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_task_items
FOR EACH ROW EXECUTE FUNCTION public.attendance_lock_task_checklist_parent();

CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item_as_service(
  _actor_id uuid, _item_id uuid, _done boolean
)
RETURNS public.attendance_task_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.attendance_tasks%ROWTYPE;
  v_old public.attendance_task_items%ROWTYPE;
  v_new public.attendance_task_items%ROWTYPE;
BEGIN
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
  SELECT i.* INTO v_old FROM public.attendance_task_items AS i WHERE i.id = _item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item not found'; END IF;

  UPDATE public.attendance_task_items
     SET is_done = _done, done_at = CASE WHEN _done THEN now() ELSE NULL END,
         done_by = CASE WHEN _done THEN _actor_id ELSE NULL END
   WHERE id = _item_id
  RETURNING * INTO v_new;

  INSERT INTO public.attendance_audit_log
    (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES ('attendance_task_items', v_new.id, 'UPDATE', _actor_id, _actor_id, to_jsonb(v_old),
    to_jsonb(v_new) || jsonb_build_object(
      '_attendance_event', CASE WHEN _done THEN 'checklist_item_done' ELSE 'checklist_item_reopened' END
    ));
  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_toggle_task_item_as_service(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_toggle_task_item_as_service(uuid, uuid, boolean) TO service_role;

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
BEGIN
  IF NOT public.has_role(_actor_id, 'staff'::public.app_role) THEN
    RAISE EXCEPTION 'Only staff accounts can complete attendance tasks';
  END IF;
  SELECT t.* INTO v_old FROM public.attendance_tasks AS t WHERE t.id = _task_id FOR UPDATE;
  IF NOT FOUND OR v_old.assigned_to <> _actor_id THEN
    RAISE EXCEPTION 'Task not found or access denied';
  END IF;
  IF v_old.status NOT IN ('pending', 'in_progress', 'rejected') THEN
    RAISE EXCEPTION 'Task is already closed';
  END IF;

  SELECT count(*) INTO v_undone_count FROM public.attendance_task_items AS i
   WHERE i.task_id = _task_id AND i.is_done IS DISTINCT FROM TRUE;
  IF v_undone_count > 0 THEN
    RAISE EXCEPTION 'All checklist items must be ticked before marking this task complete';
  END IF;
  IF v_old.requires_photo AND (_photo_path IS NULL OR btrim(_photo_path) = '') THEN
    RAISE EXCEPTION 'Photo proof is required to complete this task';
  END IF;
  IF _photo_path IS NOT NULL THEN
    IF _photo_path !~ (
      '^' || v_old.assigned_to::text || '/tasks/' || v_old.id::text ||
      '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
    ) THEN
      RAISE EXCEPTION 'Photo proof path does not match this staff member and task';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects AS so
       WHERE so.bucket_id = 'attendance-evidence' AND so.name = _photo_path
    ) THEN RAISE EXCEPTION 'Photo proof object was not found'; END IF;
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
$$;
REVOKE ALL ON FUNCTION public.attendance_complete_task_as_service(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_complete_task_as_service(uuid, uuid, text, text) TO service_role;
