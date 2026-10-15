-- FLAMIO ATTENDANCE MASTER — Owner-only settings security correction
-- REVIEW ONLY. NOT EXECUTED.
-- Scope: Supabase TEST project avwrptztixaketchgmsh only.
-- This file changes no data and must not be run until the user separately approves
-- SQL execution. Never apply to Production (wubsldblxvkusauafwfd).

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.attendance_settings') IS NULL THEN
    RAISE EXCEPTION 'Missing public.attendance_settings; aborting';
  END IF;
  IF to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.has_role(uuid,public.app_role); aborting';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'attendance_settings'
       AND policyname = 'attendance_settings_manager_update'
       AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'Expected attendance_settings_manager_update policy not found; inspect current policy state before proceeding';
  END IF;
END
$preflight$;

-- The existing attendance_is_manager() intentionally includes admins.
-- Attendance settings are an Owner-controlled feature switch, so do not use
-- attendance_is_manager() here. Both USING and WITH CHECK must be Owner-only.
DROP POLICY attendance_settings_manager_update ON public.attendance_settings;
CREATE POLICY attendance_settings_owner_update
  ON public.attendance_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_role((select auth.uid()), 'owner'::public.app_role))
  WITH CHECK (public.has_role((select auth.uid()), 'owner'::public.app_role));

COMMIT;

-- Rollback (only if this migration was applied and rollback is explicitly approved):
-- BEGIN;
-- DROP POLICY IF EXISTS attendance_settings_owner_update ON public.attendance_settings;
-- CREATE POLICY attendance_settings_manager_update
--   ON public.attendance_settings FOR UPDATE TO authenticated
--   USING (public.attendance_is_manager((select auth.uid())))
--   WITH CHECK (public.attendance_is_manager((select auth.uid())));
-- COMMIT;
