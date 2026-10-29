-- Recovered TEST source from docs/sql/attendance_selfie_evidence.sql and verified schema. Not Production.
BEGIN;
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS clock_in_selfie_path text;
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_selfie_path_owner_chk;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_selfie_path_owner_chk CHECK (clock_in_selfie_path IS NULL OR clock_in_selfie_path LIKE user_id::text || '/%');
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_selfie_path_uq ON public.attendance_sessions(clock_in_selfie_path) WHERE clock_in_selfie_path IS NOT NULL;
DROP POLICY IF EXISTS "attendance evidence staff insert own" ON storage.objects;
CREATE POLICY "attendance evidence staff insert own" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attendance-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "attendance evidence staff read own" ON storage.objects;
CREATE POLICY "attendance evidence staff read own" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'attendance-evidence' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "attendance evidence owner admin read" ON storage.objects;
CREATE POLICY "attendance evidence owner admin read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'attendance-evidence' AND (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin')));
COMMIT;
