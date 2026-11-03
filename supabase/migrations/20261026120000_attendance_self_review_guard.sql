-- FLAMIO ATTENDANCE MASTER — block manager self-review in verification RPC
-- TEST repository migration only; this file is NOT applied to any database.
-- Target TEST Supabase ref: avwrptztixaketchgmsh.
-- Production Supabase ref wubsldblxvkusauafwfd and flamio.bd are out of scope.
--
-- Keep the existing signature, SECURITY DEFINER setting, fixed search_path,
-- row lock, open-session guard, audit trigger, and existing EXECUTE ACL unchanged.
-- The current ACL intentionally limits this mutation RPC to trusted server callers.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.attendance_verify_session(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'attendance_verify_session(uuid,text,text) is missing; inspect TEST before applying';
  END IF;
  IF to_regprocedure('public.attendance_is_manager(uuid)') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'Attendance role helper is missing; inspect TEST before applying';
  END IF;
END
$preflight$;

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
  IF NOT public.attendance_is_manager(v_uid) THEN
    RAISE EXCEPTION 'Managers only';
  END IF;

  IF _status IS NULL OR _status NOT IN ('verified', 'disputed', 'unverified') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  SELECT * INTO s
    FROM public.attendance_sessions
   WHERE id = _session_id
   FOR UPDATE;

  IF s.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  -- Prevent managers from reviewing their own attendance for every status,
  -- including disputed/unverified where verified_by is NULL. Owner is exempt.
  IF s.user_id = v_uid
     AND NOT public.has_role(v_uid, 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'You cannot verify or dispute your own attendance';
  END IF;

  IF _status = 'verified' AND s.clock_out_at IS NULL THEN
    RAISE EXCEPTION 'Cannot verify an open session';
  END IF;

  UPDATE public.attendance_sessions
     SET verification_status = _status,
         verified_by = CASE WHEN _status = 'verified' THEN v_uid END,
         verified_at = CASE WHEN _status = 'verified' THEN now() END,
         verification_note = NULLIF(btrim(_note), '')
   WHERE id = s.id
   RETURNING * INTO s;

  RETURN s;
END;
$function$;

COMMIT;
