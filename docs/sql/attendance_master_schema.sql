-- =====================================================================
-- FLAMIO ATTENDANCE MASTER — schema for REVIEW ONLY (not applied)
--
-- Staff duty monitoring, shift scheduling, clock-in/out with breaks,
-- task checklists, leave and attendance-correction workflows.
--
-- Scope
--   * Contains NO restaurant commerce tables (menu, orders, inventory...).
--   * Reuses the existing Flamio identity conventions exactly:
--       public.app_role ('owner','admin','staff'), public.profiles,
--       public.user_roles, public.has_role(), public.update_updated_at_column(),
--       public.claim_owner(). Section 1 creates them ONLY if missing, with the
--       same definitions as docs/supabase-external-schema.sql.
--   * Every attendance object is prefixed `attendance_` so it can never
--     collide with existing or future restaurant objects.
--
-- Security model (summary)
--   * Owner + admin ("managers") manage everything.
--   * Staff can READ only their own rows and can WRITE only through the
--     SECURITY DEFINER functions in section 6, which always use auth.uid()
--     and the database clock (now()) — never a client-supplied user id or time.
--   * Staff have no direct INSERT/UPDATE/DELETE grant on sessions, breaks,
--     requests or the audit log, so verified fields, approvals, other users'
--     records and roles cannot be manipulated from the browser.
--   * Every change on attendance tables is written to attendance_audit_log.
--
-- Time rules
--   * All instants are timestamptz (UTC in storage).
--   * Business dates / shift wall-clock times are Asia/Dhaka (UTC+6, no DST).
--   * A shift whose end_time <= start_time ends the next day (overnight).
--   * The duty date of a session is its shift's date, otherwise the Dhaka
--     calendar date of the clock-in.
--
-- Safety: single transaction, idempotent guards, no DROP / TRUNCATE / DELETE
-- of existing data, no ALTER of existing tables.
-- =====================================================================

BEGIN;

SET check_function_bodies = false;

-- Overlap-prevention for shifts uses an exclusion constraint on (uuid, range).
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- =====================================================================
-- 1. IDENTITY FOUNDATION (create only if missing — matches existing Flamio)
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public' AND t.typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'staff');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text,
    phone text,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    avatar_path text
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role)
);

-- Pre-flight compatibility: if profiles/user_roles already exist from another
-- schema, guarantee the columns and constraint attendance functions rely on.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'user_roles_user_id_role_key'
       AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.claim_owner(_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF auth.uid() IS NULL OR _user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner') THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'owner')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
    CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Least privilege: roles are READ-ONLY for signed-in users. Role changes go
-- through the service role (server functions) only. (The full restaurant
-- schema grants wider table privileges; RLS still blocks writes there.)
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can view their own profile') THEN
    CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can insert their own profile') THEN
    CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Users can update their own profile') THEN
    CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='Users can view their own roles') THEN
    CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;
END $$;

-- =====================================================================
-- 2. ATTENDANCE HELPERS (role checks + Bangladesh time)
-- =====================================================================

-- Owner or admin.
CREATE OR REPLACE FUNCTION public.attendance_is_manager(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('owner'::public.app_role, 'admin'::public.app_role)
  );
$$;

-- Anyone on the team (owner, admin or staff). Customers are never members.
CREATE OR REPLACE FUNCTION public.attendance_is_member(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id
  );
$$;

-- Dhaka calendar date of an instant.
CREATE OR REPLACE FUNCTION public.attendance_local_date(_at timestamptz) RETURNS date
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT (_at AT TIME ZONE 'Asia/Dhaka')::date; $$;

-- Whole minutes between two instants (never negative, NULL-safe → 0).
CREATE OR REPLACE FUNCTION public.attendance_minutes(_from timestamptz, _to timestamptz) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE WHEN _from IS NULL OR _to IS NULL OR _to <= _from THEN 0
              ELSE floor(extract(epoch FROM (_to - _from)) / 60)::integer END;
$$;

-- =====================================================================
-- 3. TABLES
-- =====================================================================

-- 3.1 Settings (single row) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),          -- forces one row
    timezone text NOT NULL DEFAULT 'Asia/Dhaka' CHECK (timezone = 'Asia/Dhaka'),
    late_grace_minutes integer NOT NULL DEFAULT 10 CHECK (late_grace_minutes BETWEEN 0 AND 120),
    early_clock_in_minutes integer NOT NULL DEFAULT 60 CHECK (early_clock_in_minutes BETWEEN 0 AND 240),
    min_punch_gap_seconds integer NOT NULL DEFAULT 60 CHECK (min_punch_gap_seconds BETWEEN 0 AND 3600),
    max_session_hours integer NOT NULL DEFAULT 16 CHECK (max_session_hours BETWEEN 1 AND 24),
    allow_unscheduled_clock_in boolean NOT NULL DEFAULT true,
    updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.attendance_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 3.2 Stations (duty areas) -------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_stations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    description text CHECK (description IS NULL OR char_length(description) <= 500),
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_stations_name_key ON public.attendance_stations (lower(btrim(name)));

-- 3.3 Shifts (duty roster) --------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    station_id uuid REFERENCES public.attendance_stations(id) ON DELETE SET NULL,
    duty_role text CHECK (duty_role IS NULL OR char_length(duty_role) <= 80),
    shift_date date NOT NULL,                       -- Dhaka date the shift starts
    start_time time NOT NULL,                       -- Dhaka wall clock
    end_time time NOT NULL,                         -- <= start_time means next day
    starts_at timestamptz NOT NULL,                 -- computed by trigger
    ends_at timestamptz NOT NULL,                   -- computed by trigger
    is_overnight boolean NOT NULL DEFAULT false,    -- computed by trigger
    planned_break_minutes integer NOT NULL DEFAULT 0 CHECK (planned_break_minutes BETWEEN 0 AND 240),
    status text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','in_progress','completed','missed','cancelled','on_leave')),
    notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_shifts_time_check CHECK (end_time <> start_time),
    CONSTRAINT attendance_shifts_range_check CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '24 hours'),
    -- A person can never have two live shifts that overlap in time.
    CONSTRAINT attendance_shifts_no_overlap EXCLUDE USING gist (
        user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status NOT IN ('cancelled','on_leave'))
);
CREATE INDEX IF NOT EXISTS attendance_shifts_user_date_idx ON public.attendance_shifts (user_id, shift_date);
CREATE INDEX IF NOT EXISTS attendance_shifts_date_status_idx ON public.attendance_shifts (shift_date, status);
CREATE INDEX IF NOT EXISTS attendance_shifts_user_starts_idx ON public.attendance_shifts (user_id, starts_at);

-- 3.4 Attendance sessions (one clock-in → clock-out) -------------------
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    shift_id uuid REFERENCES public.attendance_shifts(id) ON DELETE SET NULL,
    duty_date date NOT NULL,
    clock_in_at timestamptz NOT NULL,
    clock_out_at timestamptz,
    clock_in_source text NOT NULL DEFAULT 'app' CHECK (clock_in_source IN ('app','kiosk','manager','correction')),
    clock_out_source text CHECK (clock_out_source IS NULL OR clock_out_source IN ('app','kiosk','manager','correction','auto')),
    clock_in_note text CHECK (clock_in_note IS NULL OR char_length(clock_in_note) <= 500),
    clock_out_note text CHECK (clock_out_note IS NULL OR char_length(clock_out_note) <= 500),
    -- Calculated server-side only (attendance_recalculate_session):
    break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
    worked_minutes integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
    late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
    early_leave_minutes integer NOT NULL DEFAULT 0 CHECK (early_leave_minutes >= 0),
    overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','auto_closed','corrected')),
    flags text[] NOT NULL DEFAULT '{}',             -- e.g. late, early_leave, unscheduled, long_session, auto_closed
    -- Verification (managers only):
    verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified','disputed')),
    verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at timestamptz,
    verification_note text CHECK (verification_note IS NULL OR char_length(verification_note) <= 500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_sessions_order_check CHECK (clock_out_at IS NULL OR clock_out_at > clock_in_at),
    CONSTRAINT attendance_sessions_length_check CHECK (clock_out_at IS NULL OR clock_out_at - clock_in_at <= interval '24 hours'),
    CONSTRAINT attendance_sessions_open_check CHECK ((status = 'open') = (clock_out_at IS NULL)),
    CONSTRAINT attendance_sessions_verified_check CHECK (
        (verification_status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL)
    ),
    -- No two sessions of the same person may overlap in time.
    CONSTRAINT attendance_sessions_no_overlap EXCLUDE USING gist (
        user_id WITH =, tstzrange(clock_in_at, COALESCE(clock_out_at, 'infinity'::timestamptz), '[)') WITH &&
    )
);
-- Duplicate-punch prevention: at most ONE open session per person.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_one_open_idx ON public.attendance_sessions (user_id) WHERE clock_out_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_sessions_user_date_idx ON public.attendance_sessions (user_id, duty_date);
CREATE INDEX IF NOT EXISTS attendance_sessions_date_status_idx ON public.attendance_sessions (duty_date, status);
CREATE INDEX IF NOT EXISTS attendance_sessions_shift_idx ON public.attendance_sessions (shift_id);
CREATE INDEX IF NOT EXISTS attendance_sessions_unverified_idx ON public.attendance_sessions (duty_date) WHERE verification_status <> 'verified';

-- 3.5 Breaks ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_breaks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL,
    ended_at timestamptz,
    source text NOT NULL DEFAULT 'app' CHECK (source IN ('app','kiosk','manager','correction','auto')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_breaks_order_check CHECK (ended_at IS NULL OR ended_at > started_at),
    CONSTRAINT attendance_breaks_no_overlap EXCLUDE USING gist (
        session_id WITH =, tstzrange(started_at, COALESCE(ended_at, 'infinity'::timestamptz), '[)') WITH &&
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_open_idx ON public.attendance_breaks (session_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_breaks_user_idx ON public.attendance_breaks (user_id, started_at);

-- 3.6 Tasks + checklist items -----------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assigned_to uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    shift_id uuid REFERENCES public.attendance_shifts(id) ON DELETE SET NULL,
    station_id uuid REFERENCES public.attendance_stations(id) ON DELETE SET NULL,
    title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
    description text CHECK (description IS NULL OR char_length(description) <= 2000),
    due_date date NOT NULL DEFAULT public.attendance_local_date(now()),
    due_at timestamptz,
    priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','verified','rejected','cancelled')),
    requires_verification boolean NOT NULL DEFAULT true,
    started_at timestamptz,
    completed_at timestamptz,
    completion_note text CHECK (completion_note IS NULL OR char_length(completion_note) <= 1000),
    verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    verified_at timestamptz,
    review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_tasks_completed_check CHECK (status NOT IN ('completed','verified') OR completed_at IS NOT NULL),
    CONSTRAINT attendance_tasks_verified_check CHECK ((status = 'verified') = (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS attendance_tasks_assignee_idx ON public.attendance_tasks (assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS attendance_tasks_date_status_idx ON public.attendance_tasks (due_date, status);
CREATE INDEX IF NOT EXISTS attendance_tasks_shift_idx ON public.attendance_tasks (shift_id);

CREATE TABLE IF NOT EXISTS public.attendance_task_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.attendance_tasks(id) ON DELETE CASCADE,
    label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
    sort_order integer NOT NULL DEFAULT 0,
    is_done boolean NOT NULL DEFAULT false,
    done_at timestamptz,
    done_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_task_items_done_check CHECK (is_done = (done_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS attendance_task_items_task_idx ON public.attendance_task_items (task_id, sort_order);

-- 3.7 Requests: leave, missed punch, correction, overtime ---------------
CREATE TABLE IF NOT EXISTS public.attendance_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_type text NOT NULL CHECK (request_type IN ('leave','missed_punch','correction','overtime')),
    -- leave
    leave_type text CHECK (leave_type IS NULL OR leave_type IN ('casual','sick','annual','unpaid','emergency','other')),
    leave_start_date date,
    leave_end_date date,
    -- missed_punch / correction / overtime
    session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
    target_date date,
    requested_clock_in timestamptz,
    requested_clock_out timestamptz,
    requested_overtime_minutes integer CHECK (requested_overtime_minutes IS NULL OR requested_overtime_minutes BETWEEN 1 AND 960),
    reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 1000),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 1000),
    applied_session_id uuid REFERENCES public.attendance_sessions(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT attendance_requests_leave_shape CHECK (
        request_type <> 'leave' OR (leave_type IS NOT NULL AND leave_start_date IS NOT NULL
            AND leave_end_date IS NOT NULL AND leave_end_date >= leave_start_date
            AND leave_end_date - leave_start_date <= 60)
    ),
    CONSTRAINT attendance_requests_missed_shape CHECK (
        request_type <> 'missed_punch' OR (target_date IS NOT NULL
            AND (requested_clock_in IS NOT NULL OR requested_clock_out IS NOT NULL))
    ),
    CONSTRAINT attendance_requests_correction_shape CHECK (
        request_type <> 'correction' OR (session_id IS NOT NULL
            AND (requested_clock_in IS NOT NULL OR requested_clock_out IS NOT NULL))
    ),
    CONSTRAINT attendance_requests_overtime_shape CHECK (
        request_type <> 'overtime' OR (session_id IS NOT NULL AND requested_overtime_minutes IS NOT NULL)
    ),
    CONSTRAINT attendance_requests_times_check CHECK (
        requested_clock_in IS NULL OR requested_clock_out IS NULL OR requested_clock_out > requested_clock_in
    ),
    CONSTRAINT attendance_requests_review_check CHECK (
        (status IN ('approved','rejected')) = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS attendance_requests_user_status_idx ON public.attendance_requests (user_id, status);
CREATE INDEX IF NOT EXISTS attendance_requests_pending_idx ON public.attendance_requests (created_at) WHERE status = 'pending';
-- Only one pending request per session at a time.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_pending_session_idx
    ON public.attendance_requests (session_id) WHERE status = 'pending' AND session_id IS NOT NULL;

-- 3.8 Audit log (append-only) -----------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    table_name text NOT NULL,
    row_id uuid,
    action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
    actor_id uuid,                       -- auth.uid() at the time; NULL = system/service
    subject_user_id uuid,                -- whose attendance the row belongs to
    old_data jsonb,
    new_data jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_audit_row_idx ON public.attendance_audit_log (table_name, row_id, created_at);
CREATE INDEX IF NOT EXISTS attendance_audit_subject_idx ON public.attendance_audit_log (subject_user_id, created_at);

-- =====================================================================
-- 4. TRIGGERS (timestamps, shift time math, integrity guards, audit)
-- =====================================================================

-- 4.1 Shift instants from Dhaka wall-clock, overnight aware ------------
CREATE OR REPLACE FUNCTION public.attendance_shift_compute() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.is_overnight := NEW.end_time <= NEW.start_time;
  NEW.starts_at := (NEW.shift_date + NEW.start_time) AT TIME ZONE 'Asia/Dhaka';
  NEW.ends_at := ((NEW.shift_date + CASE WHEN NEW.is_overnight THEN 1 ELSE 0 END) + NEW.end_time) AT TIME ZONE 'Asia/Dhaka';
  RETURN NEW;
END;
$$;

-- 4.2 Session guard: verified rows are locked; staff can never self-verify.
CREATE OR REPLACE FUNCTION public.attendance_session_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Attendance owner cannot be changed';
    END IF;
    -- A verified session's times cannot change until a manager un-verifies it.
    IF OLD.verification_status = 'verified' AND NEW.verification_status = 'verified' AND (
         NEW.clock_in_at IS DISTINCT FROM OLD.clock_in_at OR
         NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at OR
         NEW.shift_id IS DISTINCT FROM OLD.shift_id OR
         NEW.duty_date IS DISTINCT FROM OLD.duty_date) THEN
      RAISE EXCEPTION 'Verified attendance is locked; un-verify it first';
    END IF;
  END IF;
  -- Verification fields may only be set by a manager (or the service role).
  IF (TG_OP = 'INSERT' AND NEW.verification_status <> 'unverified')
     OR (TG_OP = 'UPDATE' AND (NEW.verification_status IS DISTINCT FROM OLD.verification_status
                               OR NEW.verified_by IS DISTINCT FROM OLD.verified_by)) THEN
    IF auth.uid() IS NOT NULL AND NOT public.attendance_is_manager(auth.uid()) THEN
      RAISE EXCEPTION 'Only a manager can verify attendance';
    END IF;
    IF NEW.verified_by IS NOT NULL AND NEW.verified_by = NEW.user_id
       AND NOT public.has_role(NEW.user_id, 'owner') THEN
      RAISE EXCEPTION 'You cannot verify your own attendance';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 4.3 Breaks must stay inside their session and belong to its person.
CREATE OR REPLACE FUNCTION public.attendance_break_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.attendance_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.attendance_sessions WHERE id = NEW.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF NEW.user_id <> s.user_id THEN RAISE EXCEPTION 'Break does not belong to this session'; END IF;
  IF NEW.started_at < s.clock_in_at THEN RAISE EXCEPTION 'Break cannot start before clock-in'; END IF;
  IF s.clock_out_at IS NOT NULL AND (NEW.ended_at IS NULL OR NEW.ended_at > s.clock_out_at) THEN
    RAISE EXCEPTION 'Break must end before clock-out';
  END IF;
  RETURN NEW;
END;
$$;

-- 4.4 Generic audit writer.
CREATE OR REPLACE FUNCTION public.attendance_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_row jsonb := COALESCE(v_new, v_old);
BEGIN
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN
    RETURN NEW;  -- no real change
  END IF;
  INSERT INTO public.attendance_audit_log (table_name, row_id, action, actor_id, subject_user_id, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    CASE WHEN TG_TABLE_NAME = 'attendance_settings' THEN NULL
         ELSE NULLIF(v_row->>'id','')::uuid END,
    TG_OP,
    auth.uid(),
    COALESCE(NULLIF(v_row->>'user_id',''), NULLIF(v_row->>'assigned_to',''))::uuid,
    v_old,
    v_new
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_settings','attendance_stations','attendance_shifts','attendance_sessions',
                           'attendance_breaks','attendance_tasks','attendance_task_items','attendance_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_updated_at') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t || '_updated_at', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t || '_audit') THEN
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.attendance_audit()', t || '_audit', t);
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_shifts_compute') THEN
    CREATE TRIGGER attendance_shifts_compute BEFORE INSERT OR UPDATE OF shift_date, start_time, end_time
      ON public.attendance_shifts FOR EACH ROW EXECUTE FUNCTION public.attendance_shift_compute();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_sessions_guard') THEN
    CREATE TRIGGER attendance_sessions_guard BEFORE INSERT OR UPDATE
      ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.attendance_session_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'attendance_breaks_guard') THEN
    CREATE TRIGGER attendance_breaks_guard BEFORE INSERT OR UPDATE
      ON public.attendance_breaks FOR EACH ROW EXECUTE FUNCTION public.attendance_break_guard();
  END IF;
END $$;

-- =====================================================================
-- 5. GRANTS + ROW LEVEL SECURITY (least privilege)
-- =====================================================================
-- anon gets nothing. Staff get SELECT (own rows via RLS). Direct writes are
-- granted only where a manager-only RLS policy exists; staff-originated
-- writes happen exclusively through section 6 functions.

GRANT SELECT, UPDATE ON public.attendance_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_stations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_shifts TO authenticated;
GRANT SELECT ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_breaks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_task_items TO authenticated;
GRANT SELECT ON public.attendance_requests TO authenticated;
GRANT SELECT ON public.attendance_audit_log TO authenticated;

GRANT ALL ON public.attendance_settings, public.attendance_stations, public.attendance_shifts,
             public.attendance_sessions, public.attendance_breaks, public.attendance_tasks,
             public.attendance_task_items, public.attendance_requests TO service_role;
GRANT SELECT, INSERT ON public.attendance_audit_log TO service_role;   -- append-only, even for service

ALTER TABLE public.attendance_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_stations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_shifts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_breaks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_tasks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_task_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_log  ENABLE ROW LEVEL SECURITY;

-- Settings: team reads, managers update.
CREATE POLICY "attendance_settings_member_read" ON public.attendance_settings FOR SELECT TO authenticated
  USING (public.attendance_is_member(auth.uid()));
CREATE POLICY "attendance_settings_manager_update" ON public.attendance_settings FOR UPDATE TO authenticated
  USING (public.attendance_is_manager(auth.uid())) WITH CHECK (public.attendance_is_manager(auth.uid()));

-- Stations: team reads, managers write.
CREATE POLICY "attendance_stations_member_read" ON public.attendance_stations FOR SELECT TO authenticated
  USING (public.attendance_is_member(auth.uid()));
CREATE POLICY "attendance_stations_manager_write" ON public.attendance_stations FOR ALL TO authenticated
  USING (public.attendance_is_manager(auth.uid())) WITH CHECK (public.attendance_is_manager(auth.uid()));

-- Shifts: staff read own, managers everything (assignee must be a team member).
CREATE POLICY "attendance_shifts_own_read" ON public.attendance_shifts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.attendance_is_manager(auth.uid()));
CREATE POLICY "attendance_shifts_manager_write" ON public.attendance_shifts FOR ALL TO authenticated
  USING (public.attendance_is_manager(auth.uid()))
  WITH CHECK (public.attendance_is_manager(auth.uid()) AND public.attendance_is_member(user_id));

-- Sessions / breaks: read own or manager. No write policies (functions only).
CREATE POLICY "attendance_sessions_own_read" ON public.attendance_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.attendance_is_manager(auth.uid()));
CREATE POLICY "attendance_breaks_own_read" ON public.attendance_breaks FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.attendance_is_manager(auth.uid()));

-- Tasks: assignee reads own; managers write. Staff progress via functions.
CREATE POLICY "attendance_tasks_own_read" ON public.attendance_tasks FOR SELECT TO authenticated
  USING (assigned_to = auth.uid() OR public.attendance_is_manager(auth.uid()));
CREATE POLICY "attendance_tasks_manager_write" ON public.attendance_tasks FOR ALL TO authenticated
  USING (public.attendance_is_manager(auth.uid()))
  WITH CHECK (public.attendance_is_manager(auth.uid()) AND public.attendance_is_member(assigned_to));

CREATE POLICY "attendance_task_items_own_read" ON public.attendance_task_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.attendance_tasks t WHERE t.id = task_id
                 AND (t.assigned_to = auth.uid() OR public.attendance_is_manager(auth.uid()))));
CREATE POLICY "attendance_task_items_manager_write" ON public.attendance_task_items FOR ALL TO authenticated
  USING (public.attendance_is_manager(auth.uid())) WITH CHECK (public.attendance_is_manager(auth.uid()));

-- Requests: read own or manager. Writes via functions only.
CREATE POLICY "attendance_requests_own_read" ON public.attendance_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.attendance_is_manager(auth.uid()));

-- Audit: managers only.
CREATE POLICY "attendance_audit_manager_read" ON public.attendance_audit_log FOR SELECT TO authenticated
  USING (public.attendance_is_manager(auth.uid()));

-- =====================================================================
-- 6. WORKFLOW FUNCTIONS (the only write path for staff)
-- =====================================================================
-- All: SECURITY DEFINER, fixed search_path, identity = auth.uid(),
-- time = now(), per-user advisory lock to serialise double taps.

-- 6.1 Recalculate durations (internal) --------------------------------
CREATE OR REPLACE FUNCTION public.attendance_recalculate_session(_session_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  s public.attendance_sessions%ROWTYPE;
  sh public.attendance_shifts%ROWTYPE;
  cfg public.attendance_settings%ROWTYPE;
  v_end timestamptz;
  v_break integer;
  v_worked integer;
  v_late integer := 0;
  v_early integer := 0;
  v_ot integer := 0;
  v_flags text[] := '{}';
BEGIN
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;

  v_end := COALESCE(s.clock_out_at, now());

  -- Breaks clipped to the session window; an open break counts up to v_end.
  SELECT COALESCE(SUM(public.attendance_minutes(GREATEST(b.started_at, s.clock_in_at),
                                                LEAST(COALESCE(b.ended_at, v_end), v_end))), 0)
    INTO v_break
    FROM public.attendance_breaks b WHERE b.session_id = s.id;

  v_worked := GREATEST(public.attendance_minutes(s.clock_in_at, v_end) - v_break, 0);

  IF s.shift_id IS NOT NULL THEN
    SELECT * INTO sh FROM public.attendance_shifts WHERE id = s.shift_id;
  END IF;

  IF sh.id IS NOT NULL THEN
    IF public.attendance_minutes(sh.starts_at, s.clock_in_at) > cfg.late_grace_minutes THEN
      v_late := public.attendance_minutes(sh.starts_at, s.clock_in_at);
      v_flags := v_flags || 'late';
    END IF;
    IF s.clock_out_at IS NOT NULL THEN
      v_early := public.attendance_minutes(s.clock_out_at, sh.ends_at);
      IF v_early > 0 THEN v_flags := v_flags || 'early_leave'; END IF;
      v_ot := GREATEST(v_worked - (public.attendance_minutes(sh.starts_at, sh.ends_at) - sh.planned_break_minutes), 0);
      IF v_ot > 0 THEN v_flags := v_flags || 'overtime'; END IF;
    END IF;
  ELSE
    v_flags := v_flags || 'unscheduled';
  END IF;

  IF public.attendance_minutes(s.clock_in_at, v_end) > cfg.max_session_hours * 60 THEN
    v_flags := v_flags || 'long_session';
  END IF;
  IF s.status = 'auto_closed' THEN v_flags := v_flags || 'auto_closed'; END IF;
  IF s.status = 'corrected'   THEN v_flags := v_flags || 'corrected'; END IF;

  UPDATE public.attendance_sessions
     SET break_minutes = v_break, worked_minutes = v_worked, late_minutes = v_late,
         early_leave_minutes = v_early, overtime_minutes = v_ot, flags = v_flags
   WHERE id = s.id;
END;
$$;

-- 6.2 Find the shift a punch belongs to (internal) --------------------
CREATE OR REPLACE FUNCTION public.attendance_match_shift(_user_id uuid, _at timestamptz) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT sh.id
    FROM public.attendance_shifts sh, public.attendance_settings cfg
   WHERE cfg.id
     AND sh.user_id = _user_id
     AND sh.status IN ('scheduled','in_progress','missed')
     AND _at >= sh.starts_at - make_interval(mins => cfg.early_clock_in_minutes)
     AND _at <  sh.ends_at
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id)
   ORDER BY abs(extract(epoch FROM (_at - sh.starts_at)))
   LIMIT 1;
$$;

-- 6.3 Clock in --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_clock_in(_note text DEFAULT NULL, _source text DEFAULT 'app')
    RETURNS public.attendance_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  cfg public.attendance_settings%ROWTYPE;
  v_shift uuid;
  v_date date;
  v_last timestamptz;
  r public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  IF _source NOT IN ('app','kiosk') THEN RAISE EXCEPTION 'Invalid source'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;

  IF EXISTS (SELECT 1 FROM public.attendance_sessions WHERE user_id = v_uid AND clock_out_at IS NULL) THEN
    RAISE EXCEPTION 'Already clocked in';
  END IF;

  SELECT max(clock_out_at) INTO v_last FROM public.attendance_sessions WHERE user_id = v_uid;
  IF v_last IS NOT NULL AND v_now - v_last < make_interval(secs => cfg.min_punch_gap_seconds) THEN
    RAISE EXCEPTION 'Please wait before clocking in again';
  END IF;

  v_shift := public.attendance_match_shift(v_uid, v_now);
  IF v_shift IS NULL AND NOT cfg.allow_unscheduled_clock_in THEN
    RAISE EXCEPTION 'No scheduled shift right now';
  END IF;
  IF v_shift IS NOT NULL THEN
    SELECT shift_date INTO v_date FROM public.attendance_shifts WHERE id = v_shift;
    UPDATE public.attendance_shifts SET status = 'in_progress' WHERE id = v_shift;
  ELSE
    v_date := public.attendance_local_date(v_now);
  END IF;

  INSERT INTO public.attendance_sessions (user_id, shift_id, duty_date, clock_in_at, clock_in_source, clock_in_note)
  VALUES (v_uid, v_shift, v_date, v_now, _source, NULLIF(btrim(_note), ''))
  RETURNING * INTO r;

  PERFORM public.attendance_recalculate_session(r.id);
  SELECT * INTO r FROM public.attendance_sessions WHERE id = r.id;
  RETURN r;
END;
$$;

-- 6.4 Start / end break ----------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_start_break() RETURNS public.attendance_breaks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session uuid;
  r public.attendance_breaks%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  SELECT id INTO v_session FROM public.attendance_sessions WHERE user_id = v_uid AND clock_out_at IS NULL;
  IF v_session IS NULL THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
  IF EXISTS (SELECT 1 FROM public.attendance_breaks WHERE session_id = v_session AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Break already started';
  END IF;
  INSERT INTO public.attendance_breaks (session_id, user_id, started_at) VALUES (v_session, v_uid, now())
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_end_break() RETURNS public.attendance_breaks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.attendance_breaks%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  UPDATE public.attendance_breaks b SET ended_at = GREATEST(now(), b.started_at + interval '1 second')
   WHERE b.user_id = v_uid AND b.ended_at IS NULL
  RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No break in progress'; END IF;
  PERFORM public.attendance_recalculate_session(r.session_id);
  RETURN r;
END;
$$;

-- 6.5 Clock out (closes any open break first) -------------------------
CREATE OR REPLACE FUNCTION public.attendance_clock_out(_note text DEFAULT NULL, _source text DEFAULT 'app')
    RETURNS public.attendance_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  cfg public.attendance_settings%ROWTYPE;
  r public.attendance_sessions%ROWTYPE;
  v_out timestamptz;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  IF _source NOT IN ('app','kiosk') THEN RAISE EXCEPTION 'Invalid source'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || v_uid::text, 0));
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;

  SELECT * INTO r FROM public.attendance_sessions WHERE user_id = v_uid AND clock_out_at IS NULL FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'You are not clocked in'; END IF;
  IF v_now - r.clock_in_at < make_interval(secs => cfg.min_punch_gap_seconds) THEN
    RAISE EXCEPTION 'You just clocked in; please wait before clocking out';
  END IF;
  IF v_now - r.clock_in_at > interval '24 hours' THEN
    RAISE EXCEPTION 'This session is too old to close; submit a correction request';
  END IF;

  -- Close any open break first; clock_out_at must enclose every break end.
  UPDATE public.attendance_breaks SET ended_at = GREATEST(v_now, started_at + interval '1 second'), source = 'auto'
   WHERE session_id = r.id AND ended_at IS NULL;

  SELECT max(ended_at) INTO v_out FROM public.attendance_breaks WHERE session_id = r.id;
  v_out := GREATEST(v_now, COALESCE(v_out, v_now));

  UPDATE public.attendance_sessions
     SET clock_out_at = v_out, clock_out_source = _source, clock_out_note = NULLIF(btrim(_note), ''), status = 'closed'
   WHERE id = r.id;
  IF r.shift_id IS NOT NULL THEN
    UPDATE public.attendance_shifts SET status = 'completed' WHERE id = r.shift_id AND status = 'in_progress';
  END IF;

  PERFORM public.attendance_recalculate_session(r.id);
  SELECT * INTO r FROM public.attendance_sessions WHERE id = r.id;
  RETURN r;
END;
$$;

-- 6.6 Staff task progress ---------------------------------------------
CREATE OR REPLACE FUNCTION public.attendance_update_task_progress(_task_id uuid, _status text, _note text DEFAULT NULL)
    RETURNS public.attendance_tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  t public.attendance_tasks%ROWTYPE;
BEGIN
  IF _status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO t FROM public.attendance_tasks WHERE id = _task_id FOR UPDATE;
  IF t.id IS NULL OR t.assigned_to <> v_uid THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF t.status NOT IN ('pending','in_progress','rejected') THEN RAISE EXCEPTION 'Task can no longer be changed'; END IF;

  UPDATE public.attendance_tasks
     SET status = _status,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN _status = 'completed' THEN now() ELSE NULL END,
         completion_note = CASE WHEN _status = 'completed' THEN NULLIF(btrim(_note), '') ELSE completion_note END,
         review_note = CASE WHEN t.status = 'rejected' THEN NULL ELSE review_note END
   WHERE id = t.id
  RETURNING * INTO t;
  RETURN t;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_toggle_task_item(_item_id uuid, _done boolean)
    RETURNS public.attendance_task_items
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  i public.attendance_task_items%ROWTYPE;
BEGIN
  SELECT it.* INTO i FROM public.attendance_task_items it
    JOIN public.attendance_tasks t ON t.id = it.task_id
   WHERE it.id = _item_id AND t.assigned_to = v_uid AND t.status IN ('pending','in_progress','rejected')
   FOR UPDATE OF it;
  IF i.id IS NULL THEN RAISE EXCEPTION 'Checklist item not found'; END IF;
  UPDATE public.attendance_task_items
     SET is_done = _done, done_at = CASE WHEN _done THEN now() END, done_by = CASE WHEN _done THEN v_uid END
   WHERE id = i.id RETURNING * INTO i;
  RETURN i;
END;
$$;

-- 6.7 Manager: verify / reject a completed task ------------------------
CREATE OR REPLACE FUNCTION public.attendance_review_task(_task_id uuid, _approve boolean, _note text DEFAULT NULL)
    RETURNS public.attendance_tasks
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  t public.attendance_tasks%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  SELECT * INTO t FROM public.attendance_tasks WHERE id = _task_id FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'completed' THEN RAISE EXCEPTION 'Task is not awaiting review'; END IF;
  IF t.assigned_to = v_uid AND NOT public.has_role(v_uid, 'owner') THEN RAISE EXCEPTION 'You cannot review your own task'; END IF;
  UPDATE public.attendance_tasks
     SET status = CASE WHEN _approve THEN 'verified' ELSE 'rejected' END,
         verified_by = CASE WHEN _approve THEN v_uid END,
         verified_at = CASE WHEN _approve THEN now() END,
         completed_at = CASE WHEN _approve THEN completed_at END,
         review_note = NULLIF(btrim(_note), '')
   WHERE id = t.id RETURNING * INTO t;
  RETURN t;
END;
$$;

-- 6.8 Staff: submit / cancel a request ---------------------------------
CREATE OR REPLACE FUNCTION public.attendance_submit_request(
    _request_type text,
    _reason text,
    _leave_type text DEFAULT NULL,
    _leave_start_date date DEFAULT NULL,
    _leave_end_date date DEFAULT NULL,
    _session_id uuid DEFAULT NULL,
    _target_date date DEFAULT NULL,
    _requested_clock_in timestamptz DEFAULT NULL,
    _requested_clock_out timestamptz DEFAULT NULL,
    _requested_overtime_minutes integer DEFAULT NULL
) RETURNS public.attendance_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.attendance_requests%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_member(v_uid) THEN RAISE EXCEPTION 'Not a team member'; END IF;
  IF _session_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.attendance_sessions WHERE id = _session_id AND user_id = v_uid) THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF _requested_clock_in > now() OR _requested_clock_out > now() THEN
    RAISE EXCEPTION 'Requested times cannot be in the future';
  END IF;
  IF _request_type IN ('missed_punch','correction') AND _target_date IS NOT NULL
     AND _target_date < public.attendance_local_date(now()) - 31 THEN
    RAISE EXCEPTION 'Corrections are limited to the last 31 days';
  END IF;
  IF _request_type = 'leave' AND EXISTS (
       SELECT 1 FROM public.attendance_requests
        WHERE user_id = v_uid AND request_type = 'leave' AND status IN ('pending','approved')
          AND daterange(leave_start_date, leave_end_date, '[]') && daterange(_leave_start_date, _leave_end_date, '[]')) THEN
    RAISE EXCEPTION 'You already have leave for these dates';
  END IF;

  INSERT INTO public.attendance_requests (
      user_id, request_type, leave_type, leave_start_date, leave_end_date, session_id, target_date,
      requested_clock_in, requested_clock_out, requested_overtime_minutes, reason)
  VALUES (
      v_uid, _request_type, _leave_type, _leave_start_date, _leave_end_date, _session_id,
      COALESCE(_target_date, (SELECT duty_date FROM public.attendance_sessions WHERE id = _session_id)),
      _requested_clock_in, _requested_clock_out, _requested_overtime_minutes, btrim(_reason))
  RETURNING * INTO r;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_cancel_request(_request_id uuid) RETURNS public.attendance_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r public.attendance_requests%ROWTYPE;
BEGIN
  UPDATE public.attendance_requests SET status = 'cancelled'
   WHERE id = _request_id AND user_id = auth.uid() AND status = 'pending'
  RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Request not found or already reviewed'; END IF;
  RETURN r;
END;
$$;

-- 6.9 Manager: approve / reject a request (applies the change) ---------
CREATE OR REPLACE FUNCTION public.attendance_review_request(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
    RETURNS public.attendance_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  q public.attendance_requests%ROWTYPE;
  s public.attendance_sessions%ROWTYPE;
  v_session uuid;
  v_shift uuid;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  SELECT * INTO q FROM public.attendance_requests WHERE id = _request_id FOR UPDATE;
  IF q.id IS NULL OR q.status <> 'pending' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
  IF q.user_id = v_uid AND NOT public.has_role(v_uid, 'owner') THEN
    RAISE EXCEPTION 'You cannot approve your own request';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || q.user_id::text, 0));

  IF _approve THEN
    IF q.request_type = 'leave' THEN
      UPDATE public.attendance_shifts SET status = 'on_leave'
       WHERE user_id = q.user_id AND status = 'scheduled'
         AND shift_date BETWEEN q.leave_start_date AND q.leave_end_date;

    ELSIF q.request_type = 'missed_punch' THEN
      IF q.requested_clock_in IS NULL OR q.requested_clock_out IS NULL THEN
        RAISE EXCEPTION 'A missed-punch approval needs both clock-in and clock-out';
      END IF;
      v_shift := public.attendance_match_shift(q.user_id, q.requested_clock_in);
      INSERT INTO public.attendance_sessions (user_id, shift_id, duty_date, clock_in_at, clock_out_at,
             clock_in_source, clock_out_source, status)
      VALUES (q.user_id, v_shift, q.target_date,
              q.requested_clock_in, q.requested_clock_out, 'correction', 'correction', 'corrected')
      RETURNING id INTO v_session;
      IF v_shift IS NOT NULL THEN
        UPDATE public.attendance_shifts SET status = 'completed' WHERE id = v_shift;
      END IF;

    ELSIF q.request_type = 'correction' THEN
      SELECT * INTO s FROM public.attendance_sessions WHERE id = q.session_id FOR UPDATE;
      IF s.id IS NULL THEN RAISE EXCEPTION 'Session no longer exists'; END IF;
      UPDATE public.attendance_sessions
         SET verification_status = 'unverified', verified_by = NULL, verified_at = NULL,
             clock_in_at = COALESCE(q.requested_clock_in, clock_in_at),
             clock_out_at = COALESCE(q.requested_clock_out, clock_out_at),
             clock_in_source = CASE WHEN q.requested_clock_in IS NOT NULL THEN 'correction' ELSE clock_in_source END,
             clock_out_source = CASE WHEN q.requested_clock_out IS NOT NULL THEN 'correction' ELSE clock_out_source END,
             status = CASE WHEN COALESCE(q.requested_clock_out, clock_out_at) IS NULL THEN 'open' ELSE 'corrected' END
       WHERE id = s.id;
      v_session := s.id;

    ELSIF q.request_type = 'overtime' THEN
      v_session := q.session_id;   -- approval recorded; payroll reads approved overtime requests
    END IF;

    IF v_session IS NOT NULL THEN
      PERFORM public.attendance_recalculate_session(v_session);
    END IF;
  END IF;

  UPDATE public.attendance_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_uid, reviewed_at = now(), review_note = NULLIF(btrim(_note), ''),
         applied_session_id = v_session
   WHERE id = q.id RETURNING * INTO q;
  RETURN q;
END;
$$;

-- 6.10 Manager: verify / dispute / un-verify a session -----------------
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

-- 6.11 Manager: direct correction with mandatory reason ----------------
CREATE OR REPLACE FUNCTION public.attendance_manager_correct_session(
    _session_id uuid, _clock_in_at timestamptz, _clock_out_at timestamptz, _reason text)
    RETURNS public.attendance_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  s public.attendance_sessions%ROWTYPE;
BEGIN
  IF NOT public.attendance_is_manager(v_uid) THEN RAISE EXCEPTION 'Managers only'; END IF;
  IF _reason IS NULL OR char_length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _clock_in_at > now() OR _clock_out_at > now() THEN RAISE EXCEPTION 'Times cannot be in the future'; END IF;
  SELECT * INTO s FROM public.attendance_sessions WHERE id = _session_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF s.user_id = v_uid AND NOT public.has_role(v_uid, 'owner') THEN RAISE EXCEPTION 'You cannot correct your own attendance'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || s.user_id::text, 0));

  -- Update the session first so attendance_break_guard sees the new window.
  UPDATE public.attendance_sessions
     SET verification_status = 'unverified', verified_by = NULL, verified_at = NULL,
         clock_in_at = _clock_in_at, clock_out_at = _clock_out_at,
         clock_in_source = 'manager', clock_out_source = CASE WHEN _clock_out_at IS NOT NULL THEN 'manager' END,
         status = CASE WHEN _clock_out_at IS NULL THEN 'open' ELSE 'corrected' END,
         verification_note = btrim(_reason)
   WHERE id = s.id;

  IF _clock_out_at IS NOT NULL THEN
    UPDATE public.attendance_breaks SET ended_at = _clock_out_at, source = 'correction'
     WHERE session_id = s.id AND (ended_at IS NULL OR ended_at > _clock_out_at);
  END IF;

  IF _clock_in_at IS NOT NULL THEN
    UPDATE public.attendance_breaks SET started_at = _clock_in_at, source = 'correction'
     WHERE session_id = s.id AND started_at < _clock_in_at;
  END IF;
  PERFORM public.attendance_recalculate_session(s.id);
  SELECT * INTO s FROM public.attendance_sessions WHERE id = s.id;
  RETURN s;
END;
$$;

-- 6.12 System: auto-close forgotten sessions, mark missed shifts --------
-- Intended for a scheduled job using the service role (never staff).
CREATE OR REPLACE FUNCTION public.attendance_run_maintenance() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  cfg public.attendance_settings%ROWTYPE;
  s record;
  v_closed integer := 0;
  v_missed integer := 0;
  v_out timestamptz;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'owner') THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;
  SELECT * INTO cfg FROM public.attendance_settings WHERE id;

  FOR s IN
    SELECT se.id, se.clock_in_at, sh.ends_at
      FROM public.attendance_sessions se
      LEFT JOIN public.attendance_shifts sh ON sh.id = se.shift_id
     WHERE se.clock_out_at IS NULL
       AND now() - se.clock_in_at > make_interval(hours => cfg.max_session_hours)
     FOR UPDATE OF se
  LOOP
    -- Close at the shift end if known, otherwise at the max length. Never later.
    v_out := LEAST(COALESCE(s.ends_at, s.clock_in_at + make_interval(hours => cfg.max_session_hours)),
                   s.clock_in_at + make_interval(hours => cfg.max_session_hours));
    v_out := GREATEST(v_out, s.clock_in_at + interval '1 minute');
    UPDATE public.attendance_breaks SET ended_at = v_out, source = 'auto'
     WHERE session_id = s.id AND (ended_at IS NULL OR ended_at > v_out);
    UPDATE public.attendance_sessions
       SET clock_out_at = v_out, clock_out_source = 'auto', status = 'auto_closed'
     WHERE id = s.id;
    PERFORM public.attendance_recalculate_session(s.id);
    v_closed := v_closed + 1;
  END LOOP;

  UPDATE public.attendance_shifts sh SET status = 'missed'
   WHERE sh.status = 'scheduled' AND sh.ends_at < now()
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id);
  GET DIAGNOSTICS v_missed = ROW_COUNT;

  UPDATE public.attendance_shifts sh SET status = 'completed'
   WHERE sh.status = 'in_progress'
     AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions x WHERE x.shift_id = sh.id AND x.clock_out_at IS NULL);

  RETURN jsonb_build_object('auto_closed', v_closed, 'missed', v_missed);
END;
$$;

-- 6.13 Manager: team directory (names only) without widening profiles RLS.
CREATE OR REPLACE FUNCTION public.attendance_team_directory()
    RETURNS TABLE (user_id uuid, full_name text, phone text, roles public.app_role[])
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT ur.user_id, p.full_name, p.phone, array_agg(ur.role ORDER BY ur.role)
    FROM public.user_roles ur
    LEFT JOIN public.profiles p ON p.id = ur.user_id
   WHERE public.attendance_is_manager(auth.uid())
   GROUP BY ur.user_id, p.full_name, p.phone;
$$;

-- =====================================================================
-- 7. FUNCTION EXECUTE PRIVILEGES
-- =====================================================================
-- Postgres grants EXECUTE to PUBLIC by default — revoke, then re-grant
-- only what each audience needs.

REVOKE ALL ON FUNCTION public.claim_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_owner(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.attendance_recalculate_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attendance_match_shift(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attendance_audit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attendance_run_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_run_maintenance() TO service_role;

REVOKE ALL ON FUNCTION public.attendance_clock_in(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_clock_out(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_start_break() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_end_break() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_update_task_progress(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_toggle_task_item(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_review_task(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_submit_request(text, text, text, date, date, uuid, date, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_cancel_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_review_request(uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_verify_session(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_manager_correct_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attendance_team_directory() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.attendance_clock_in(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_clock_out(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_start_break() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_end_break() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_update_task_progress(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_toggle_task_item(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_review_task(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_submit_request(text, text, text, date, date, uuid, date, timestamptz, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_cancel_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_review_request(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_manager_correct_session(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_team_directory() TO authenticated;

COMMIT;

-- =====================================================================
-- APPLYING (later, after approval) — not part of this transaction
-- 1. Back up / snapshot the TEST project first.
-- 2. Run this whole file once in the SQL Editor. It is one transaction:
--    any error rolls everything back, leaving the database unchanged.
-- 3. Bootstrap the first owner: sign up in the app, then that user calls
--    claim_owner(auth.uid()). Add staff via the service role (server).
-- 4. Schedule attendance_run_maintenance() every 15 min with the service
--    role (pg_cron or the app's existing minute dispatcher).
-- 5. Rollback for TEST only: drop the attendance_* objects (script to be
--    supplied separately on request). Identity tables are left untouched.
-- =====================================================================
