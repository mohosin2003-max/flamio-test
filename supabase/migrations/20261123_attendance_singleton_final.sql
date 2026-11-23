-- FLAMIO ATTENDANCE MASTER — TEST final singleton hardening
-- Target: TEST Supabase only.
-- Ensures attendance_settings cannot contain a second configuration row.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_settings_singleton_idx
  ON public.attendance_settings ((true));
