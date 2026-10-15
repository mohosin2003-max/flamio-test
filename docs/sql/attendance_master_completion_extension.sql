-- FLAMIO ATTENDANCE MASTER — completion extension for review only
-- TEST project ref: avwrptztixaketchgmsh
-- NOT EXECUTED. Do not apply without explicit user approval.
-- Production ref wubsldblxvkusauafwfd is out of scope.
--
-- This migration adds optional station geofencing, single-use QR challenge
-- storage, and a 30-day attendance-session retention routine. It deliberately
-- does not store selfie images, delete tasks, or delete audit logs.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.attendance_settings') IS NULL
     OR to_regclass('public.attendance_stations') IS NULL
     OR to_regclass('public.attendance_sessions') IS NULL
     OR to_regclass('public.attendance_breaks') IS NULL THEN
    RAISE EXCEPTION 'Attendance base tables are missing; aborting extension';
  END IF;
END
$preflight$;

ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS geofence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selfie_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attendance_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 30
    CHECK (retention_days BETWEEN 30 AND 30);

ALTER TABLE public.attendance_stations
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 100
    CHECK (geofence_radius_meters BETWEEN 25 AND 1000);

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_stations_latitude_range') THEN
    ALTER TABLE public.attendance_stations ADD CONSTRAINT attendance_stations_latitude_range
      CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_stations_longitude_range') THEN
    ALTER TABLE public.attendance_stations ADD CONSTRAINT attendance_stations_longitude_range
      CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS public.attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.attendance_stations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_qr_challenge_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT attendance_qr_challenge_consumption_check
    CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS attendance_qr_challenges_expiry_idx
  ON public.attendance_qr_challenges (expires_at);
ALTER TABLE public.attendance_qr_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_qr_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_qr_challenges TO service_role;

-- Atomic single-use QR consumption. The application must hash the raw
-- cryptographically-random QR token with SHA-256 and pass only the hash.
CREATE OR REPLACE FUNCTION public.attendance_consume_qr_challenge(_token_hash text)
RETURNS TABLE (station_id uuid, challenge_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  UPDATE public.attendance_qr_challenges q
     SET consumed_at = now(), consumed_by = v_uid
   WHERE q.token_hash = _token_hash
     AND q.consumed_at IS NULL
     AND q.expires_at > now()
   RETURNING q.station_id, q.id INTO v_station, v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'QR challenge is invalid, expired, or already used';
  END IF;

  RETURN QUERY SELECT v_station, v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_consume_qr_challenge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text) TO authenticated, service_role;

-- Extend the existing service-role maintenance function with 30-day session
-- retention. Session deletion cascades to breaks; task and audit history are
-- intentionally retained. This is a destructive operation once scheduled,
-- so it must not be applied until the retention behavior is separately reviewed.
CREATE OR REPLACE FUNCTION public.attendance_purge_expired_sessions()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days integer;
  v_deleted bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT retention_days INTO v_days
    FROM public.attendance_settings WHERE id = true;
  v_days := COALESCE(v_days, 30);

  DELETE FROM public.attendance_sessions
   WHERE clock_out_at IS NOT NULL
     AND clock_out_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION public.attendance_purge_expired_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_purge_expired_sessions() TO service_role;

COMMIT;

-- REQUIRED BEFORE RELEASE (manual, separately approved operations):
-- 1. Review this draft and apply only to TEST after explicit approval.
-- 2. Implement UI/server code for Owner geofence configuration and QR issuance.
-- 3. QR issuance must use a cryptographically random token, store only SHA-256,
--    expire within 60 seconds, and never return the hash as the QR payload.
-- 4. Clock-in must validate coordinates server-side using a geodesic distance
--    calculation and enforce the configured station radius.
-- 5. A camera preview alone is NOT identity verification. A verified identity
--    provider or Owner-reviewed ephemeral capture flow is required before
--    selfie verification can be marked complete. Never persist selfie images.
-- 6. Schedule attendance_run_maintenance() and attendance_purge_expired_sessions()
--    with the existing trusted scheduler/service role, with failure monitoring.
-- 7. Do not schedule either function until test accounts and retention boundaries
--    have been validated. This file does not configure a scheduler.
