-- Owner-controlled Data & Storage Management (cleanup system)
-- Additive and idempotent. Creates four new tables only.
-- It does NOT touch, rename, reset or migrate any existing table, policy,
-- bucket or row. Safe to run more than once.

-- 1) Per-category retention / schedule configuration -------------------------
CREATE TABLE IF NOT EXISTS public.cleanup_settings (
  category text PRIMARY KEY,
  auto_enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 3650),
  frequency_days integer NOT NULL DEFAULT 7 CHECK (frequency_days BETWEEN 1 AND 365),
  require_approval boolean NOT NULL DEFAULT true,
  unlocked boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Global safety switches (single row, id = 'global') ----------------------
CREATE TABLE IF NOT EXISTS public.cleanup_state (
  id text PRIMARY KEY DEFAULT 'global',
  auto_paused boolean NOT NULL DEFAULT false,
  paused_reason text,
  large_deletion_threshold integer NOT NULL DEFAULT 500
    CHECK (large_deletion_threshold BETWEEN 10 AND 100000),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.cleanup_state (id)
SELECT 'global'
WHERE NOT EXISTS (SELECT 1 FROM public.cleanup_state WHERE id = 'global');

-- 3) Cleanup audit history (never cleaned by the cleanup system) -------------
CREATE TABLE IF NOT EXISTS public.cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL CHECK (run_type IN ('manual', 'auto', 'preview', 'storage', 'control')),
  category text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'completed', 'partial', 'failed', 'cancelled', 'preview', 'skipped', 'awaiting_approval'
  )),
  retention_days integer,
  cutoff_at timestamptz,
  requested_count integer NOT NULL DEFAULT 0,
  deleted_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  protected_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  files_deleted integer NOT NULL DEFAULT 0,
  bytes_released bigint,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_label text,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS cleanup_runs_started_idx ON public.cleanup_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS cleanup_runs_category_idx ON public.cleanup_runs (category, started_at DESC);

-- 4) Per-record outcome for a run -------------------------------------------
CREATE TABLE IF NOT EXISTS public.cleanup_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.cleanup_runs(id) ON DELETE CASCADE,
  record_ref text NOT NULL,
  record_label text,
  outcome text NOT NULL CHECK (outcome IN ('deleted', 'protected', 'skipped', 'failed')),
  reason text,
  bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cleanup_run_items_run_idx ON public.cleanup_run_items (run_id, created_at);

-- Data API grants: reads happen through owner-only server code (service role).
GRANT ALL ON public.cleanup_settings TO service_role;
GRANT ALL ON public.cleanup_state TO service_role;
GRANT ALL ON public.cleanup_runs TO service_role;
GRANT ALL ON public.cleanup_run_items TO service_role;
GRANT SELECT ON public.cleanup_settings TO authenticated;
GRANT SELECT ON public.cleanup_state TO authenticated;
GRANT SELECT ON public.cleanup_runs TO authenticated;
GRANT SELECT ON public.cleanup_run_items TO authenticated;

ALTER TABLE public.cleanup_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleanup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleanup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cleanup_run_items ENABLE ROW LEVEL SECURITY;

-- Owner-only read. No USING (true), no customer or staff access, and no
-- INSERT/UPDATE/DELETE policy at all: every write goes through the
-- owner-checked server functions using the service role.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cleanup_settings'
      AND policyname = 'Owners read cleanup settings'
  ) THEN
    CREATE POLICY "Owners read cleanup settings" ON public.cleanup_settings
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'owner'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cleanup_state'
      AND policyname = 'Owners read cleanup state'
  ) THEN
    CREATE POLICY "Owners read cleanup state" ON public.cleanup_state
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'owner'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cleanup_runs'
      AND policyname = 'Owners read cleanup runs'
  ) THEN
    CREATE POLICY "Owners read cleanup runs" ON public.cleanup_runs
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'owner'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cleanup_run_items'
      AND policyname = 'Owners read cleanup run items'
  ) THEN
    CREATE POLICY "Owners read cleanup run items" ON public.cleanup_run_items
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(), 'owner'));
  END IF;
END $$;

-- OPTIONAL — only run this once the owner wants automatic cleanup to actually
-- execute. It reuses the existing pg_cron + pg_net scheduler pattern already
-- used by the notification dispatcher. Replace the URL with your published
-- project URL and the secret with the existing cron secret.
--
-- select cron.schedule(
--   'flamio-data-cleanup',
--   '15 3 * * *',
--   $$select net.http_post(
--       url := 'https://<your-app-domain>/api/public/cleanup/run',
--       headers := '{"content-type":"application/json","authorization":"Bearer <LOVABLE_CRON_SECRET>"}'::jsonb,
--       body := '{}'::jsonb
--   )$$
-- );
