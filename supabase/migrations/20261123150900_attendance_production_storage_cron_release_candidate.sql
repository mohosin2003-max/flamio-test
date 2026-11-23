-- FLAMIO ATTENDANCE MASTER — Production storage + maintenance release candidate
-- DO NOT APPLY TO PRODUCTION YET.
-- Storage settings verified from TEST. Feature switches remain OFF.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attendance-evidence','attendance-evidence',false,1500000,ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET name='attendance-evidence',
    public=false,
    file_size_limit=1500000,
    allowed_mime_types=ARRAY['image/jpeg'];

CREATE POLICY attendance_evidence_member_read_own
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'attendance-evidence'
  AND attendance_is_member(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY attendance_evidence_member_upload_own
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'attendance-evidence'
  AND attendance_is_member(auth.uid())
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Maintenance is intentionally fail-closed while Attendance is disabled.
-- The photo orphan sweep remains disabled because its edge-function endpoint
-- and production secrets must be configured separately.
SELECT cron.schedule(
  'attendance-duty-end-overtime-maintenance',
  '* * * * *',
  'select public.attendance_process_duty_end_and_overtime();'
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'attendance-duty-end-overtime-maintenance'
);

SELECT cron.schedule(
  'attendance-monthly-record-retention',
  '0 4 1 * *',
  'select public.attendance_purge_old_records();'
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'attendance-monthly-record-retention'
);
