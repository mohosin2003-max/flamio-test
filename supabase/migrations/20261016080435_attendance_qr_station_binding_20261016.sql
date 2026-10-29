-- FLAMIO ATTENDANCE MASTER — bind QR consumption to assigned station
-- TEST Supabase ref avwrptztixaketchgmsh only; Production ref wubsldblxvkusauafwfd is out of scope.
-- No attendance records are changed or deleted.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.attendance_qr_challenges') IS NULL
     OR to_regprocedure('public.attendance_consume_qr_challenge(text)') IS NULL THEN
    RAISE EXCEPTION 'Expected QR challenge schema/function missing; aborting';
  END IF;
END
$preflight$;

DROP FUNCTION public.attendance_consume_qr_challenge(text);

CREATE FUNCTION public.attendance_consume_qr_challenge(
  _token_hash text,
  _expected_station_id uuid
)
RETURNS TABLE (station_id uuid, challenge_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $consume$
DECLARE
  v_uid uuid := auth.uid();
  v_station uuid;
  v_id uuid;
BEGIN
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
$consume$;

REVOKE ALL ON FUNCTION public.attendance_consume_qr_challenge(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text, uuid) TO authenticated, service_role;

COMMIT;
