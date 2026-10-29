-- Recovered source snapshot for TEST DB migration 20261029130242.
-- Exact current function definition verified against TEST on 2026-10-29.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_list_expired_evidence_paths(_limit integer DEFAULT 500)
 RETURNS TABLE(object_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH expired_session_refs AS (
    SELECT s.clock_in_selfie_path AS path, so.created_at AS object_created_at
      FROM public.attendance_sessions AS s
      LEFT JOIN storage.objects AS so
        ON so.bucket_id = 'attendance-evidence'
       AND so.name = s.clock_in_selfie_path
     WHERE s.clock_in_selfie_path IS NOT NULL
       AND s.clock_in_selfie_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
       AND s.clock_out_at IS NOT NULL
       AND s.clock_out_at < now() - interval '30 days'
       AND s.status <> 'open'
       AND s.status <> 'auto_closed'
       AND s.verification_status <> 'disputed'
       AND s.verification_status <> 'unverified'
       AND (so.name IS NULL OR so.created_at < now() - interval '30 days')
  ),
  expired_task_refs AS (
    SELECT t.photo_path AS path, so.created_at AS object_created_at
      FROM public.attendance_tasks AS t
      LEFT JOIN storage.objects AS so
        ON so.bucket_id = 'attendance-evidence'
       AND so.name = t.photo_path
     WHERE t.photo_path IS NOT NULL
       AND t.photo_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
       AND t.status IN ('completed','verified','cancelled','rejected')
       AND COALESCE(t.completed_at, t.created_at) < now() - interval '30 days'
       AND (so.name IS NULL OR so.created_at < now() - interval '30 days')
  ),
  candidates AS (
    SELECT path FROM expired_session_refs
    UNION
    SELECT path FROM expired_task_refs
  )
  SELECT path
    FROM candidates
   ORDER BY path
   LIMIT LEAST(GREATEST(COALESCE(_limit, 500), 1), 500);
$function$
;
REVOKE ALL ON FUNCTION public.attendance_list_expired_evidence_paths(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_list_expired_evidence_paths(integer) TO service_role;
COMMIT;
