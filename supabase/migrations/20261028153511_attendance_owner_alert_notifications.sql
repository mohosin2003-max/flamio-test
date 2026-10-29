-- Recovered idempotent TEST schema snapshot. Exact historical SQL was unavailable; do not apply to Production.
ALTER TABLE public.attendance_settings ADD COLUMN IF NOT EXISTS attendance_alerts_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.attendance_settings.attendance_alerts_enabled IS 'Owner-controlled switch for attendance alert notifications.';
