-- FLAMIO ATTENDANCE MASTER — secure Owner request-review bridge for server-role clients
-- TEST Supabase ref avwrptztixaketchgmsh only.
-- Production ref wubsldblxvkusauafwfd is strictly out of scope.
-- Uses the existing transactional review function; no unrelated rows are changed.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.attendance_review_request(uuid,boolean,text)') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'Expected attendance request-review dependencies missing; aborting';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.attendance_review_request_as_service(
  _request_id uuid,
  _approve boolean,
  _note text,
  _actor_id uuid
)
RETURNS public.attendance_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $review$
DECLARE
  v_request public.attendance_requests%ROWTYPE;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'Only the Owner can review attendance requests';
  END IF;

  -- The wrapper is callable only by service_role. Set the verified Owner ID
  -- transaction-locally so the existing transactional RPC can apply all
  -- request types using its normal auth.uid() checks and validation helpers.
  PERFORM set_config('request.jwt.claim.sub', _actor_id::text, true);
  SELECT * INTO v_request
    FROM public.attendance_review_request(_request_id, _approve, _note);
  RETURN v_request;
END;
$review$;

REVOKE ALL ON FUNCTION public.attendance_review_request_as_service(uuid, boolean, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_review_request_as_service(uuid, boolean, text, uuid) TO service_role;

COMMIT;
