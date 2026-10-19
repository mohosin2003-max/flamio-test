-- FLAMIO ATTENDANCE MASTER — Selfie photo evidence
-- REVIEW ONLY. NOT APPLIED. Target: TEST project avwrptztixaketchgmsh ONLY.
-- Never run against Production wubsldblxvkusauafwfd.
--
-- Step 1 (separately, NOT SQL): create a PRIVATE bucket via the storage tool:
--   name = attendance-evidence, public = false, file_size_limit = 1.5MB,
--   allowed types = image/jpeg
--
-- Stores only a storage path (text). No image bytes, base64, or biometric data.

BEGIN;

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS clock_in_selfie_path text;

ALTER TABLE public.attendance_sessions
  DROP CONSTRAINT IF EXISTS attendance_sessions_selfie_path_owner_chk;
ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT attendance_sessions_selfie_path_owner_chk
  CHECK (clock_in_selfie_path IS NULL OR clock_in_selfie_path LIKE user_id::text || '/%');

CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_selfie_path_uq
  ON public.attendance_sessions(clock_in_selfie_path)
  WHERE clock_in_selfie_path IS NOT NULL;

-- Storage RLS. App uploads/reads through the server (service role), so these
-- policies only govern direct client access: staff own folder, owner/admin read.
DROP POLICY IF EXISTS "attendance evidence staff insert own" ON storage.objects;
CREATE POLICY "attendance evidence staff insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "attendance evidence staff read own" ON storage.objects;
CREATE POLICY "attendance evidence staff read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "attendance evidence owner admin read" ON storage.objects;
CREATE POLICY "attendance evidence owner admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-evidence'
    AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')));

-- No UPDATE or DELETE policies: staff cannot overwrite or remove evidence.
-- Deletion happens only via the server-side retention job (service role).

COMMIT;

-- Verification (read-only, after approval):
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='attendance_sessions' AND column_name='clock_in_selfie_path';
-- SELECT policyname, cmd FROM pg_policies WHERE schemaname='storage' AND policyname LIKE 'attendance evidence%';
--
-- Rollback (removes evidence references; storage files must be deleted separately):
-- DROP POLICY IF EXISTS "attendance evidence staff insert own" ON storage.objects;
-- DROP POLICY IF EXISTS "attendance evidence staff read own" ON storage.objects;
-- DROP POLICY IF EXISTS "attendance evidence owner admin read" ON storage.objects;
-- DROP INDEX IF EXISTS public.attendance_sessions_selfie_path_uq;
-- ALTER TABLE public.attendance_sessions DROP COLUMN IF EXISTS clock_in_selfie_path;
