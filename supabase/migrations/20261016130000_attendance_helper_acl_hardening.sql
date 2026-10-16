-- FLAMIO ATTENDANCE MASTER — helper function ACL/search_path hardening
-- TEST Supabase ref: avwrptztixaketchgmsh only.
-- Production ref wubsldblxvkusauafwfd is out of scope.
-- No attendance rows are inserted, updated or deleted.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.attendance_local_date(timestamp with time zone)') IS NULL
     OR to_regprocedure('public.attendance_minutes(timestamp with time zone,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.attendance_is_manager(uuid)') IS NULL
     OR to_regprocedure('public.attendance_is_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Expected attendance helper function missing; aborting';
  END IF;
END
$preflight$;

-- These deterministic helpers only operate on supplied timestamps. Fix their
-- search_path so the function environment is explicit and stable.
ALTER FUNCTION public.attendance_local_date(timestamp with time zone) SET search_path TO 'public';
ALTER FUNCTION public.attendance_minutes(timestamp with time zone, timestamp with time zone) SET search_path TO 'public';

-- Membership/manager helpers are used by authenticated RLS and attendance RPCs.
-- They are not public lookup endpoints: remove anonymous/public execution while
-- preserving their intended use by authenticated sessions and trusted services.
REVOKE ALL ON FUNCTION public.attendance_is_manager(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_is_manager(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.attendance_is_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_is_member(uuid) TO authenticated, service_role;

COMMIT;
