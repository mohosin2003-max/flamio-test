-- Recovered source snapshot for TEST DB migration 20261029130039.
-- Exact current function definition verified against TEST on 2026-10-29.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_clear_expired_evidence_refs(_paths text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_sessions integer := 0;
  v_tasks integer := 0;
BEGIN
  IF COALESCE(cardinality(_paths), 0) = 0 THEN
    RETURN jsonb_build_object('sessions_cleared', 0, 'tasks_cleared', 0);
  END IF;

  -- Fail closed: accept only the exact path shapes produced by the app
  -- for clock-in selfies or task-photo evidence.
  IF EXISTS (
    SELECT 1
    FROM unnest(_paths) AS supplied(path)
    WHERE supplied.path IS NULL
       OR supplied.path !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/([0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg|tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg)$'
  ) THEN
    RAISE EXCEPTION 'Invalid attendance evidence path; no references were changed';
  END IF;

  UPDATE public.attendance_sessions AS s
     SET clock_in_selfie_path = NULL
   WHERE s.clock_in_selfie_path = ANY(_paths)
     AND s.clock_in_selfie_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
     AND s.clock_out_at IS NOT NULL
     AND s.clock_out_at < now() - interval '30 days'
     AND s.status <> 'open'
     AND s.status <> 'auto_closed'
     AND s.verification_status <> 'disputed'
     AND s.verification_status <> 'unverified';
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  UPDATE public.attendance_tasks AS t
     SET photo_path = NULL
   WHERE t.photo_path = ANY(_paths)
     AND t.photo_path ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/tasks/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[0-9]{13}-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[.]jpg$'
     AND t.status IN ('completed','verified','cancelled','rejected')
     AND COALESCE(t.completed_at, t.created_at) < now() - interval '30 days';
  GET DIAGNOSTICS v_tasks = ROW_COUNT;

  RETURN jsonb_build_object('sessions_cleared', v_sessions, 'tasks_cleared', v_tasks);
END;
$function$
;
REVOKE ALL ON FUNCTION public.attendance_clear_expired_evidence_refs(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_clear_expired_evidence_refs(text[]) TO service_role;
COMMIT;
