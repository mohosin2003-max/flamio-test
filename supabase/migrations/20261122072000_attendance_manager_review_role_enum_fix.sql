-- FLAMIO ATTENDANCE MASTER — TEST ONLY
-- app_role uses owner/admin/staff; the UI calls admin-level reviewers Manager.
-- Reconcile the service bridge with the actual enum without changing production.

CREATE OR REPLACE FUNCTION public.attendance_review_request_as_service(
  _request_id uuid,
  _approve boolean,
  _note text,
  _actor_id uuid
)
RETURNS public.attendance_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
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
$function$;
