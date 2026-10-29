-- Recovered source for TEST migration history version 20261028193237.
-- 90-day record retention; later versions refine age basis and protected states.
-- Historical SQL was recovered as a staged reconstruction, not a byte-identical archive.
BEGIN;
CREATE OR REPLACE FUNCTION public.attendance_purge_old_records()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sessions integer := 0;
  v_tasks integer := 0;
begin
  delete from public.attendance_sessions s
   where s.clock_out_at is not null
     and s.clock_out_at < now() - interval '90 days'
     and s.status <> 'open'
     and s.status <> 'auto_closed';
  get diagnostics v_sessions = row_count;

  delete from public.attendance_tasks t
   where t.status in ('completed','verified','cancelled','rejected')
     and t.created_at < now() - interval '90 days';
  get diagnostics v_tasks = row_count;

  return jsonb_build_object('sessions_deleted', v_sessions, 'tasks_deleted', v_tasks);
end;
$function$;

REVOKE ALL ON FUNCTION public.attendance_purge_old_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_purge_old_records() TO service_role;

COMMIT;
