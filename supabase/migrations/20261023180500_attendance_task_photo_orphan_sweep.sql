-- FLAMIO ATTENDANCE MASTER — TEST-only orphan task-photo cleanup scheduler.
-- Deletes only task-photo objects older than 24 hours that are not referenced by attendance_tasks.photo_path.
-- Never deletes attendance sessions, selfies, linked evidence, or Production data.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'attendance_task_photo_cleanup_secret', 'Private shared secret for TEST task-photo orphan sweep');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_project_url') THEN
    PERFORM vault.create_secret('https://avwrptztixaketchgmsh.supabase.co', 'attendance_task_photo_cleanup_project_url', 'TEST Supabase URL for task-photo orphan sweep');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_publishable_key') THEN
    PERFORM vault.create_secret('sb_publishable_SGkE79RC4zt4f8u3s6Oxmg_130cEqjv', 'attendance_task_photo_cleanup_publishable_key', 'Public publishable key for TEST cron Edge Function invocation');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.attendance_verify_task_photo_cleanup_secret(_provided_secret text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'attendance_task_photo_cleanup_secret'
       AND decrypted_secret = _provided_secret
  ), false);
$$;
REVOKE ALL ON FUNCTION public.attendance_verify_task_photo_cleanup_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_verify_task_photo_cleanup_secret(text) TO service_role;

CREATE OR REPLACE FUNCTION public.attendance_list_orphan_task_photo_paths(_limit integer DEFAULT 500)
RETURNS TABLE(object_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT so.name::text
    FROM storage.objects AS so
   WHERE so.bucket_id = 'attendance-evidence'
     AND so.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/tasks/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'
     AND so.created_at < now() - interval '24 hours'
     AND NOT EXISTS (
       SELECT 1 FROM public.attendance_tasks AS t WHERE t.photo_path = so.name
     )
   ORDER BY so.created_at ASC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 500), 1), 500);
$$;
REVOKE ALL ON FUNCTION public.attendance_list_orphan_task_photo_paths(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_list_orphan_task_photo_paths(integer) TO service_role;

-- Daily at 03:00 UTC (09:00 Asia/Dhaka). Deploy the Edge Function before applying this migration.
SELECT cron.schedule(
  'attendance-task-photo-orphan-sweep',
  '0 3 * * *',
  $job$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_project_url')
              || '/functions/v1/attendance-task-photo-orphan-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_publishable_key'),
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_publishable_key'),
        'x-attendance-cleanup-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'attendance_task_photo_cleanup_secret')
      ),
      body := jsonb_build_object('dryRun', false),
      timeout_milliseconds := 15000
    );
  $job$
);
