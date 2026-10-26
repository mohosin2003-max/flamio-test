-- FLAMIO ATTENDANCE MASTER — manager self-review fix (TEST ONLY: avwrptztixaketchgmsh)
-- NOT APPLIED. Run only after explicit approval, in the TEST SQL editor.
-- Never run against Production (wubsldblxvkusauafwfd).
-- Scope: replaces attendance_verify_session + attendance_session_guard bodies only.
-- Signature, SECURITY DEFINER, search_path, row lock, open-session guard,
-- Owner exemption and audit trigger behaviour are preserved.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_verify_session(_session_id uuid, _status text, _note text DEFAULT NULL)
    RETURNS public.attendance_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF _status NOT IN ('verified','disputed','unverified') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  -- NEW: non-Owner managers can never review their own session, for any status.
  IF s.user_id = v_uid AND NOT public.has_role(v_uid, 'owner') THEN
    RAISE EXCEPTION 'You cannot review your own attendance';
  END IF;
  IF _status = 'verified' AND s.clock_out_at IS NULL THEN RAISE EXCEPTION 'Cannot verify an open session'; END IF;
  UPDATE public.attendance_sessions
     SET verification_status = _status,
         verified_by = CASE WHEN _status = 'verified' THEN v_uid END,
         verified_at = CASE WHEN _status = 'verified' THEN now() END,
         verification_note = NULLIF(btrim(_note), '')
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_session_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Attendance owner cannot be changed';
    END IF;
    IF OLD.verification_status = 'verified' AND NEW.verification_status = 'verified' AND (
         NEW.clock_in_at IS DISTINCT FROM OLD.clock_in_at OR
         NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at OR
         NEW.shift_id IS DISTINCT FROM OLD.shift_id OR
         NEW.duty_date IS DISTINCT FROM OLD.duty_date) THEN
      RAISE EXCEPTION 'Verified attendance is locked; un-verify it first';
    END IF;
  END IF;
  IF (TG_OP = 'INSERT' AND NEW.verification_status <> 'unverified')
     OR (TG_OP = 'UPDATE' AND (NEW.verification_status IS DISTINCT FROM OLD.verification_status
                               OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
                               OR NEW.verification_note IS DISTINCT FROM OLD.verification_note)) THEN
    IF auth.uid() IS NOT NULL AND NOT public.attendance_is_manager(auth.uid()) THEN
      RAISE EXCEPTION 'Only a manager can verify attendance';
    END IF;
    -- NEW: block self-review by the acting user regardless of verified_by.
    IF auth.uid() IS NOT NULL AND auth.uid() = NEW.user_id
       AND NOT public.has_role(auth.uid(), 'owner') THEN
      RAISE EXCEPTION 'You cannot review your own attendance';
    END IF;
    IF NEW.verified_by IS NOT NULL AND NEW.verified_by = NEW.user_id
       AND NOT public.has_role(NEW.user_id, 'owner') THEN
      RAISE EXCEPTION 'You cannot verify your own attendance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Least privilege unchanged: authenticated only; the procedure checks roles itself.
REVOKE ALL ON FUNCTION public.attendance_verify_session(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session(uuid, text, text) TO authenticated;

COMMIT;

-- ROLLBACK NOTE: restoring the old bodies (attendance_master_schema.sql §4.2/§6.10)
-- re-opens the manager self-dispute/unverify gap. Prefer a forward fix instead.
