-- FLAMIO ATTENDANCE MASTER — independent Attendance / Tasks switches.
-- TEST ONLY (project ref avwrptztixaketchgmsh). Additive and reversible.
-- NOT APPLIED: this workspace has no direct database connection.
-- Apply in the TEST project's SQL editor after confirming the project ref.
-- Until applied, the app treats both features as ON (current behaviour) and
-- the Owner switch shows "database update needed".

BEGIN;

ALTER TABLE public.attendance_settings
  ADD COLUMN IF NOT EXISTS attendance_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tasks_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.attendance_settings.attendance_enabled IS 'Owner switch: clock-in/out and breaks allowed. Enforced in server functions.';
COMMENT ON COLUMN public.attendance_settings.tasks_enabled IS 'Owner switch: task assignment/completion allowed. Enforced in server functions.';

COMMIT;

-- Verify:
--   SELECT attendance_enabled, tasks_enabled FROM public.attendance_settings WHERE id;
-- Rollback:
--   ALTER TABLE public.attendance_settings DROP COLUMN IF EXISTS attendance_enabled, DROP COLUMN IF EXISTS tasks_enabled;
