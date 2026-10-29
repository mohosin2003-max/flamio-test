-- FLAMIO ATTENDANCE MASTER — TEST-only security and verification schema extension
-- Repository: mohosin2003-max/flamio-test
-- Target Supabase ref: avwrptztixaketchgmsh
-- Production ref wubsldblxvkusauafwfd is strictly out of scope.
-- This file is reviewed code only until separately applied to the TEST database.
-- No data deletion, scheduler, or production operation is included.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.attendance_settings') IS NULL
     OR to_regclass('public.attendance_stations') IS NULL
     OR to_regclass('public.attendance_sessions') IS NULL
     OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL
     OR to_regprocedure('public.attendance_is_manager(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Attendance prerequisites are missing; aborting TEST migration';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'attendance_settings'
       AND policyname = 'attendance_settings_manager_update'
       AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Expected legacy settings policy is missing; inspect TEST policy state';
  END IF;
END
$preflight$;

-- Keep role-helper execution out of PUBLIC/anon while preserving its use by
-- authenticated RLS policies and trusted server-side functions.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- Remove staff phone from the manager directory RPC. Its current function has
-- no dependent database objects in the TEST schema. The caller must still be
-- a manager (Owner/Admin) and execute is restricted to authenticated sessions.
DROP FUNCTION public.attendance_team_directory();
CREATE FUNCTION public.attendance_team_directory()
RETURNS TABLE (user_id uuid, full_name text, roles public.app_role[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $directory$
  SELECT ur.user_id, p.full_name, array_agg(ur.role ORDER BY ur.role)
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
   WHERE public.attendance_is_manager(auth.uid())
   GROUP BY ur.user_id, p.full_name;
$directory$;
REVOKE ALL ON FUNCTION public.attendance_team_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_team_directory() TO authenticated;

-- Attendance settings and security-sensitive feature switches are Owner-only.
DROP POLICY attendance_settings_manager_update ON public.attendance_settings;
CREATE POLICY attendance_settings_owner_update
  ON public.attendance_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role((select auth.uid()), 'owner'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'owner'::public.app_role));

-- Add optional verification controls and station geofence configuration.
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS geofence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS selfie_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attendance_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 30;

DO $retention_constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'attendance_settings_retention_days_check'
       AND conrelid = 'public.attendance_settings'::regclass
  ) THEN
    ALTER TABLE public.attendance_settings
      ADD CONSTRAINT attendance_settings_retention_days_check
      CHECK (retention_days = 30);
  END IF;
END
$retention_constraint$;

ALTER TABLE public.attendance_stations
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geofence_radius_meters integer NOT NULL DEFAULT 100;

DO $station_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_stations_latitude_range' AND conrelid = 'public.attendance_stations'::regclass) THEN
    ALTER TABLE public.attendance_stations ADD CONSTRAINT attendance_stations_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_stations_longitude_range' AND conrelid = 'public.attendance_stations'::regclass) THEN
    ALTER TABLE public.attendance_stations ADD CONSTRAINT attendance_stations_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_stations_geofence_radius_check' AND conrelid = 'public.attendance_stations'::regclass) THEN
    ALTER TABLE public.attendance_stations ADD CONSTRAINT attendance_stations_geofence_radius_check CHECK (geofence_radius_meters BETWEEN 25 AND 1000);
  END IF;
END
$station_constraints$;

-- Store only SHA-256 hashes of QR tokens. Raw QR tokens must never be stored.
CREATE TABLE IF NOT EXISTS public.attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.attendance_stations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_qr_challenge_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT attendance_qr_challenge_consumption_check CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS attendance_qr_challenges_expiry_idx ON public.attendance_qr_challenges (expires_at);
ALTER TABLE public.attendance_qr_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_qr_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_qr_challenges TO service_role;

-- Atomically consume a single-use QR challenge; the application hashes the
-- random token with SHA-256 and supplies only that hash.
CREATE OR REPLACE FUNCTION public.attendance_consume_qr_challenge(_token_hash text)
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
  IF _token_hash IS NULL OR _token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid QR token';
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
$consume$;
REVOKE ALL ON FUNCTION public.attendance_consume_qr_challenge(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text) TO authenticated, service_role;

COMMIT;

-- Deliberately not included: session deletion/retention scheduling, push delivery
-- hooks, GPS enforcement, QR issuance UI, and selfie verification. These require
-- separate implementation and acceptance tests before being called complete.
