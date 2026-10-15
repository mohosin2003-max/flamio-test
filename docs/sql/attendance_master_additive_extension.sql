-- FLAMIO ATTENDANCE MASTER — additive feature extension
-- REVIEW ONLY. DO NOT EXECUTE until TEST schema preflight and separate approval.
-- Target: TEST project avwrptztixaketchgmsh only.
-- Explicitly does not alter profiles, user_roles, app_role, has_role(), or other identity objects.
-- This draft creates metadata/event tables only. Workflow RPCs, scheduling and integration tests
-- must be reviewed and deployed separately after checking the actual TEST schema.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.attendance_settings') IS NULL THEN
    RAISE EXCEPTION 'Missing public.attendance_settings; apply/reconcile the reviewed attendance core schema first';
  END IF;
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE EXCEPTION 'Missing public.attendance_sessions; apply/reconcile the reviewed attendance core schema first';
  END IF;
  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.has_role(uuid,public.app_role); do not modify identity schema automatically';
  END IF;
END
$preflight$;

-- Owner-controlled feature flags. These are additive columns on the new attendance table only.
ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS system_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geofence_radius_m integer NOT NULL DEFAULT 100
    CHECK (geofence_radius_m BETWEEN 25 AND 1000),
  ADD COLUMN IF NOT EXISTS selfie_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS qr_verification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 30
    CHECK (retention_days BETWEEN 7 AND 90);

-- Event metadata only: do not store selfies, image bytes, or permanent photo URLs.
CREATE TABLE IF NOT EXISTS public.attendance_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('geofence_enter','geofence_exit','reentry','clock_in_check','clock_out_check')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric(9,6),
  longitude numeric(9,6),
  accuracy_m numeric(8,2),
  distance_from_site_m numeric(8,2),
  result text NOT NULL CHECK (result IN ('accepted','rejected','inaccurate','permission_denied','unavailable')),
  reason_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_location_latitude_check CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT attendance_location_longitude_check CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_location_accuracy_check CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  CONSTRAINT attendance_location_distance_check CHECK (distance_from_site_m IS NULL OR distance_from_site_m >= 0)
);
CREATE INDEX IF NOT EXISTS attendance_location_events_user_time_idx
  ON public.attendance_location_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS attendance_location_events_session_idx
  ON public.attendance_location_events(session_id, occurred_at DESC);

-- Push delivery ledger stores outcomes, never private push secrets or full payloads.
CREATE TABLE IF NOT EXISTS public.attendance_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'clock_in','clock_out','late','geofence_enter','geofence_exit','reentry',
    'break_start','break_end','task_due','task_completed','verification_required','system_alert'
  )),
  channel text NOT NULL CHECK (channel IN ('push','in_app')),
  delivery_status text NOT NULL DEFAULT 'queued'
    CHECK (delivery_status IN ('queued','sent','failed','skipped')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  safe_error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_notification_events_status_idx
  ON public.attendance_notification_events(delivery_status, created_at);
CREATE INDEX IF NOT EXISTS attendance_notification_events_recipient_idx
  ON public.attendance_notification_events(recipient_user_id, created_at DESC);

-- Verification outcomes only. A selfie must be processed ephemerally and discarded;
-- this table intentionally has no image, image URL, or biometric-template column.
CREATE TABLE IF NOT EXISTS public.attendance_verification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
  method text NOT NULL CHECK (method IN ('selfie_ephemeral','qr','manager_review')),
  result text NOT NULL CHECK (result IN ('passed','failed','expired','cancelled','unavailable')),
  verified_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  safe_reason_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_verification_user_time_idx
  ON public.attendance_verification_events(user_id, created_at DESC);

-- QR challenges hold only a hash; plaintext challenge values must never be stored.
CREATE TABLE IF NOT EXISTS public.attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_qr_challenge_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT attendance_qr_challenge_consume_check CHECK (
    (consumed_at IS NULL AND consumed_by IS NULL) OR (consumed_at IS NOT NULL AND consumed_by IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS attendance_qr_challenges_expiry_idx
  ON public.attendance_qr_challenges(expires_at);

-- Retention ledger supports an auditable scheduled cleanup. This draft does not
-- install a scheduler or delete data; deletion policy must be separately reviewed.
CREATE TABLE IF NOT EXISTS public.attendance_retention_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 7 AND 90),
  dry_run boolean NOT NULL DEFAULT true,
  sessions_eligible bigint NOT NULL DEFAULT 0 CHECK (sessions_eligible >= 0),
  location_events_eligible bigint NOT NULL DEFAULT 0 CHECK (location_events_eligible >= 0),
  verification_events_eligible bigint NOT NULL DEFAULT 0 CHECK (verification_events_eligible >= 0),
  notification_events_eligible bigint NOT NULL DEFAULT 0 CHECK (notification_events_eligible >= 0),
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','completed','failed')),
  safe_error_code text
);

ALTER TABLE public.attendance_location_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_qr_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_retention_runs ENABLE ROW LEVEL SECURITY;

-- Staff may read only their own minimal event records. Managers may read team records.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_location_events' AND policyname='attendance_location_events_owner_read') THEN
    CREATE POLICY attendance_location_events_owner_read ON public.attendance_location_events
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_notification_events' AND policyname='attendance_notification_events_owner_read') THEN
    CREATE POLICY attendance_notification_events_owner_read ON public.attendance_notification_events
      FOR SELECT TO authenticated
      USING (recipient_user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_verification_events' AND policyname='attendance_verification_events_owner_read') THEN
    CREATE POLICY attendance_verification_events_owner_read ON public.attendance_verification_events
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'owner'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_qr_challenges' AND policyname='attendance_qr_challenges_owner_all') THEN
    CREATE POLICY attendance_qr_challenges_owner_all ON public.attendance_qr_challenges
      FOR ALL TO authenticated
      USING (public.has_role(auth.uid(), 'owner'::public.app_role))
      WITH CHECK (public.has_role(auth.uid(), 'owner'::public.app_role));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='attendance_retention_runs' AND policyname='attendance_retention_runs_owner_read') THEN
    CREATE POLICY attendance_retention_runs_owner_read ON public.attendance_retention_runs
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'owner'::public.app_role));
  END IF;
END
$policies$;

-- No client direct writes: only reviewed SECURITY DEFINER RPCs/service-role workers
-- should insert events, consume QR challenges, deliver notifications or run retention.
REVOKE INSERT, UPDATE, DELETE ON public.attendance_location_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_notification_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_verification_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_qr_challenges FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.attendance_retention_runs FROM authenticated;

GRANT SELECT ON public.attendance_location_events TO authenticated;
GRANT SELECT ON public.attendance_notification_events TO authenticated;
GRANT SELECT ON public.attendance_verification_events TO authenticated;
GRANT SELECT ON public.attendance_qr_challenges TO authenticated;
GRANT SELECT ON public.attendance_retention_runs TO authenticated;

COMMIT;

-- Mandatory before execution:
-- 1. Verify the active project ref is exactly avwrptztixaketchgmsh.
-- 2. Verify the core attendance schema, extension, roles, grants and existing RLS.
-- 3. Add reviewed server-side RPCs for owner settings, clock-in/out, geofence plausibility,
--    notification delivery/retries, QR challenge hash/consume, ephemeral selfie verification,
--    and dry-run retention. Do not expose service-role credentials to the client.
-- 4. Test against an isolated TEST clone and request separate explicit approval.
-- 5. Do not execute this file or any DELETE/retention job without separate approval.
