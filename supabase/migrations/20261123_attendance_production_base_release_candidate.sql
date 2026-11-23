-- FLAMIO ATTENDANCE MASTER
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY TO PRODUCTION YET
-- Source: verified TEST schema avwrptztixaketchgmsh
-- Production target: psckjmopvxaqvroaltfu
-- This migration is intentionally additive and starts the schema clean-room.
-- Feature switches are OFF on creation.
-- Runtime functions/RLS/ACL/cron are released only after this base schema passes
-- isolated validation; do not skip dependency validation.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    RAISE EXCEPTION 'Required public.app_role enum is missing';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attendance_settings (
  id boolean PRIMARY KEY DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Dhaka',
  late_grace_minutes integer NOT NULL DEFAULT 10,
  early_clock_in_minutes integer NOT NULL DEFAULT 60,
  min_punch_gap_seconds integer NOT NULL DEFAULT 60,
  max_session_hours integer NOT NULL DEFAULT 16,
  allow_unscheduled_clock_in boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  geofence_enabled boolean NOT NULL DEFAULT false,
  selfie_verification_enabled boolean NOT NULL DEFAULT false,
  qr_verification_enabled boolean NOT NULL DEFAULT false,
  attendance_alerts_enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 30,
  attendance_enabled boolean NOT NULL DEFAULT false,
  tasks_enabled boolean NOT NULL DEFAULT false,
  CONSTRAINT attendance_settings_id_check CHECK (id),
  CONSTRAINT attendance_settings_timezone_check CHECK (timezone = 'Asia/Dhaka'),
  CONSTRAINT attendance_settings_late_grace_minutes_check CHECK (late_grace_minutes BETWEEN 0 AND 120),
  CONSTRAINT attendance_settings_early_clock_in_minutes_check CHECK (early_clock_in_minutes BETWEEN 0 AND 240),
  CONSTRAINT attendance_settings_min_punch_gap_seconds_check CHECK (min_punch_gap_seconds BETWEEN 0 AND 3600),
  CONSTRAINT attendance_settings_max_session_hours_check CHECK (max_session_hours BETWEEN 1 AND 24),
  CONSTRAINT attendance_settings_retention_days_check CHECK (retention_days = 30)
);

CREATE TABLE IF NOT EXISTS public.attendance_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  latitude double precision,
  longitude double precision,
  geofence_radius_meters integer NOT NULL DEFAULT 100,
  CONSTRAINT attendance_stations_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT attendance_stations_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  CONSTRAINT attendance_stations_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT attendance_stations_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT attendance_stations_geofence_radius_check CHECK (geofence_radius_meters BETWEEN 25 AND 1000)
);

CREATE TABLE IF NOT EXISTS public.attendance_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  station_id uuid REFERENCES public.attendance_stations(id) ON DELETE SET NULL,
  duty_role text,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_overnight boolean NOT NULL DEFAULT false,
  planned_break_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_shifts_time_check CHECK (end_time <> start_time),
  CONSTRAINT attendance_shifts_range_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '24 hours'),
  CONSTRAINT attendance_shifts_planned_break_minutes_check CHECK (planned_break_minutes BETWEEN 0 AND 240),
  CONSTRAINT attendance_shifts_status_check CHECK (status IN ('scheduled','in_progress','completed','missed','cancelled','on_leave')),
  CONSTRAINT attendance_shifts_duty_role_check CHECK (duty_role IS NULL OR char_length(duty_role) <= 80),
  CONSTRAINT attendance_shifts_notes_check CHECK (notes IS NULL OR char_length(notes) <= 1000),
  CONSTRAINT attendance_shifts_no_overlap EXCLUDE USING gist
    (user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status <> ALL (ARRAY['cancelled','on_leave']))
);

CREATE TABLE IF NOT EXISTS public.attendance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_type text NOT NULL,
  leave_type text,
  leave_start_date date,
  leave_end_date date,
  session_id uuid,
  target_date date,
  requested_clock_in timestamptz,
  requested_clock_out timestamptz,
  requested_overtime_minutes integer,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  applied_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_overtime_start_at timestamptz,
  approved_overtime_end_at timestamptz,
  CONSTRAINT attendance_requests_request_type_check CHECK (request_type IN ('leave','missed_punch','correction','overtime')),
  CONSTRAINT attendance_requests_status_check CHECK (status IN ('pending','approved','rejected','cancelled')),
  CONSTRAINT attendance_requests_leave_type_check CHECK (leave_type IS NULL OR leave_type IN ('casual','sick','annual','unpaid','emergency','other')),
  CONSTRAINT attendance_requests_requested_overtime_minutes_check CHECK (requested_overtime_minutes IS NULL OR requested_overtime_minutes BETWEEN 1 AND 960),
  CONSTRAINT attendance_requests_overtime_duration_check CHECK (request_type <> 'overtime' OR requested_overtime_minutes IN (30,60,90,120)),
  CONSTRAINT attendance_requests_overtime_shape CHECK (request_type <> 'overtime' OR (session_id IS NOT NULL AND requested_overtime_minutes IS NOT NULL)),
  CONSTRAINT attendance_requests_leave_shape CHECK (
    request_type <> 'leave' OR
    (leave_type IS NOT NULL AND leave_start_date IS NOT NULL AND leave_end_date IS NOT NULL
     AND leave_end_date >= leave_start_date AND leave_end_date - leave_start_date <= 60)
  ),
  CONSTRAINT attendance_requests_missed_shape CHECK (
    request_type <> 'missed_punch' OR
    (target_date IS NOT NULL AND requested_clock_in IS NOT NULL AND requested_clock_out IS NOT NULL)
  ),
  CONSTRAINT attendance_requests_correction_shape CHECK (
    request_type <> 'correction' OR
    (session_id IS NOT NULL AND (requested_clock_in IS NOT NULL OR requested_clock_out IS NOT NULL))
  ),
  CONSTRAINT attendance_requests_times_check CHECK (
    requested_clock_in IS NULL OR requested_clock_out IS NULL OR requested_clock_out > requested_clock_in
  ),
  CONSTRAINT attendance_requests_reason_check CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
  CONSTRAINT attendance_requests_review_check CHECK (
    (status IN ('approved','rejected')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT attendance_requests_review_note_check CHECK (review_note IS NULL OR char_length(review_note) <= 1000)
);

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  shift_id uuid REFERENCES public.attendance_shifts(id) ON DELETE SET NULL,
  duty_date date NOT NULL,
  clock_in_at timestamptz NOT NULL,
  clock_out_at timestamptz,
  clock_in_source text NOT NULL DEFAULT 'app',
  clock_out_source text,
  clock_in_note text,
  clock_out_note text,
  break_minutes integer NOT NULL DEFAULT 0,
  worked_minutes integer NOT NULL DEFAULT 0,
  late_minutes integer NOT NULL DEFAULT 0,
  early_leave_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  flags text[] NOT NULL DEFAULT '{}',
  verification_status text NOT NULL DEFAULT 'unverified',
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  clock_in_selfie_path text,
  session_kind text NOT NULL DEFAULT 'normal',
  overtime_request_id uuid,
  CONSTRAINT attendance_sessions_clock_in_source_check CHECK (clock_in_source IN ('app','kiosk','manager','correction')),
  CONSTRAINT attendance_sessions_clock_out_source_check CHECK (clock_out_source IS NULL OR clock_out_source IN ('app','kiosk','manager','correction','auto')),
  CONSTRAINT attendance_sessions_status_check CHECK (status IN ('open','closed','auto_closed','corrected')),
  CONSTRAINT attendance_sessions_verification_status_check CHECK (verification_status IN ('unverified','verified','disputed')),
  CONSTRAINT attendance_sessions_session_kind_check CHECK (session_kind IN ('normal','overtime')),
  CONSTRAINT attendance_sessions_order_check CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
  CONSTRAINT attendance_sessions_length_check CHECK (clock_out_at IS NULL OR clock_out_at - clock_in_at <= interval '24 hours'),
  CONSTRAINT attendance_sessions_open_check CHECK ((status = 'open') = (clock_out_at IS NULL)),
  CONSTRAINT attendance_sessions_verified_check CHECK (
    (verification_status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT attendance_sessions_selfie_path_owner_chk CHECK (
    clock_in_selfie_path IS NULL OR clock_in_selfie_path LIKE user_id::text || '/%'
  ),
  CONSTRAINT attendance_sessions_no_overlap EXCLUDE USING gist
    (user_id WITH =, tstzrange(clock_in_at, COALESCE(clock_out_at,'infinity'::timestamptz), '[)') WITH &&)
);

ALTER TABLE public.attendance_requests
  ADD CONSTRAINT attendance_requests_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.attendance_requests
  ADD CONSTRAINT attendance_requests_applied_session_id_fkey
  FOREIGN KEY (applied_session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT attendance_sessions_overtime_request_id_fkey
  FOREIGN KEY (overtime_request_id) REFERENCES public.attendance_requests(id) ON DELETE SET NULL NOT VALID;

CREATE TABLE IF NOT EXISTS public.attendance_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_breaks_order_check CHECK (ended_at IS NULL OR ended_at > started_at),
  CONSTRAINT attendance_breaks_source_check CHECK (source IN ('app','kiosk','manager','correction','auto')),
  CONSTRAINT attendance_breaks_no_overlap EXCLUDE USING gist
    (session_id WITH =, tstzrange(started_at, COALESCE(ended_at,'infinity'::timestamptz), '[)') WITH &&)
);

CREATE TABLE IF NOT EXISTS public.attendance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assigned_to uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shift_id uuid REFERENCES public.attendance_shifts(id) ON DELETE SET NULL,
  station_id uuid REFERENCES public.attendance_stations(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  due_date date NOT NULL DEFAULT public.attendance_local_date(now()),
  due_at timestamptz,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'pending',
  requires_verification boolean NOT NULL DEFAULT true,
  started_at timestamptz,
  completed_at timestamptz,
  completion_note text,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  requires_photo boolean NOT NULL DEFAULT false,
  photo_path text,
  CONSTRAINT attendance_tasks_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT attendance_tasks_description_check CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT attendance_tasks_priority_check CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT attendance_tasks_status_check CHECK (status IN ('pending','in_progress','completed','verified','rejected','cancelled')),
  CONSTRAINT attendance_tasks_completed_check CHECK (status NOT IN ('completed','verified') OR completed_at IS NOT NULL),
  CONSTRAINT attendance_tasks_verified_check CHECK ((status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT attendance_tasks_completion_note_check CHECK (completion_note IS NULL OR char_length(completion_note) <= 1000),
  CONSTRAINT attendance_tasks_review_note_check CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
  CONSTRAINT attendance_tasks_photo_path_format_chk CHECK (
    photo_path IS NULL OR photo_path ~ ('^' || assigned_to::text || '/tasks/' || id::text ||
      '/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$')
  )
);

CREATE TABLE IF NOT EXISTS public.attendance_task_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.attendance_tasks(id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT attendance_task_items_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT attendance_task_items_done_check CHECK (is_done = (done_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.attendance_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.attendance_stations(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  distance_from_site_m numeric(8,2) NOT NULL,
  accuracy_m numeric(8,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_location_events_event_type_check CHECK (event_type IN ('geofence_enter','geofence_exit','reentry')),
  CONSTRAINT attendance_location_events_distance_from_site_m_check CHECK (distance_from_site_m >= 0),
  CONSTRAINT attendance_location_events_accuracy_m_check CHECK (accuracy_m >= 0)
);

CREATE TABLE IF NOT EXISTS public.attendance_qr_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id uuid NOT NULL REFERENCES public.attendance_stations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_qr_challenges_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT attendance_qr_challenge_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT attendance_qr_challenge_consumption_check CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);

CREATE TABLE IF NOT EXISTS public.attendance_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,
  actor_id uuid,
  subject_user_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_audit_log_action_check CHECK (action IN ('INSERT','UPDATE','DELETE'))
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_settings_singleton_idx
  ON public.attendance_settings ((id))
  WHERE id = true;

-- Keep the live release disabled until the application code, RLS, ACL, storage,
-- functions and scheduled maintenance are validated together.
INSERT INTO public.attendance_settings (id, attendance_enabled, tasks_enabled)
VALUES (true, false, false)
ON CONFLICT (id) DO UPDATE
SET attendance_enabled = false,
    tasks_enabled = false,
    updated_at = now();

COMMENT ON TABLE public.attendance_settings IS
  'FLAMIO Attendance Master production release candidate; feature switches intentionally OFF until final live smoke test.';
