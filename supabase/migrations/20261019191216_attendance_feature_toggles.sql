-- Recovered TEST migration source; reconstructed from verified schema and docs/sql/attendance_feature_toggles.sql. Not Production.
BEGIN;
ALTER TABLE public.attendance_settings ADD COLUMN IF NOT EXISTS attendance_enabled boolean NOT NULL DEFAULT true, ADD COLUMN IF NOT EXISTS tasks_enabled boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.attendance_settings.attendance_enabled IS 'Owner switch: clock-in/out and breaks allowed. Enforced in server functions.';
COMMENT ON COLUMN public.attendance_settings.tasks_enabled IS 'Owner switch: task assignment/completion allowed. Enforced in server functions.';
COMMIT;
