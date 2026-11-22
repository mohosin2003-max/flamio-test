-- FLAMIO ATTENDANCE MASTER — TEST ONLY
-- Finalize agreed attendance settings before real-device QA.
-- Production untouched.

UPDATE public.attendance_settings
SET selfie_verification_enabled=false,
    updated_at=now()
WHERE id=true
  AND selfie_verification_enabled=true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance_settings
    WHERE id=true
      AND attendance_enabled=true
      AND tasks_enabled=true
      AND geofence_enabled=true
      AND qr_verification_enabled=false
      AND selfie_verification_enabled=false
      AND retention_days=30
  ) THEN
    RAISE EXCEPTION 'Final attendance settings verification failed';
  END IF;
END $$;
