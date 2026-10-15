-- FLAMIO ATTENDANCE MASTER — Owner-only settings security correction
-- REVIEW ONLY. NOT EXECUTED.
-- Scope: Supabase TEST project avwrptztixaketchgmsh only.
-- This file changes policy/function definitions but no application rows. Do not run until the user separately approves
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

-- Remove the legacy role-enumeration RPC exposure and explicitly scope execution.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- The team directory must not disclose personal phone numbers.
CREATE OR REPLACE FUNCTION public.attendance_team_directory()
  RETURNS TABLE (user_id uuid, full_name text, roles public.app_role[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public'
  AS $
    SELECT ur.user_id, p.full_name, array_agg(ur.role ORDER BY ur.role)
      FROM public.user_roles ur
      LEFT JOIN public.profiles p ON p.id = ur.user_id
     WHERE public.attendance_is_manager(auth.uid())
     GROUP BY ur.user_id, p.full_name;
  $;

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
