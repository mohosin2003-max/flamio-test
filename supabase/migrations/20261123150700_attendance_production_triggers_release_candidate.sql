-- FLAMIO ATTENDANCE MASTER — verified TEST triggers
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at=now(); RETURN NEW; END $function$;

CREATE TRIGGER attendance_breaks_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_breaks
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_breaks_guard
BEFORE INSERT OR UPDATE ON public.attendance_breaks
FOR EACH ROW EXECUTE FUNCTION public.attendance_break_guard();

CREATE TRIGGER attendance_breaks_updated_at
BEFORE UPDATE ON public.attendance_breaks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_requests_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_requests
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_requests_updated_at
BEFORE UPDATE ON public.attendance_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_validate_request_submission_trg
BEFORE INSERT ON public.attendance_requests
FOR EACH ROW EXECUTE FUNCTION public.attendance_validate_request_submission();

CREATE TRIGGER attendance_sessions_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_sessions_guard
BEFORE INSERT OR UPDATE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.attendance_session_guard();

CREATE TRIGGER attendance_sessions_updated_at
BEFORE UPDATE ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_settings_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_settings
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_settings_updated_at
BEFORE UPDATE ON public.attendance_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_shifts_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_shifts
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_shifts_compute
BEFORE INSERT OR UPDATE ON public.attendance_shifts
FOR EACH ROW EXECUTE FUNCTION public.attendance_shift_compute();

CREATE TRIGGER attendance_shifts_updated_at
BEFORE UPDATE ON public.attendance_shifts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_stations_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_stations
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_stations_updated_at
BEFORE UPDATE ON public.attendance_stations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_task_items_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_task_items
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_task_items_lock_parent
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_task_items
FOR EACH ROW EXECUTE FUNCTION public.attendance_lock_task_checklist_parent();

CREATE TRIGGER attendance_task_items_updated_at
BEFORE UPDATE ON public.attendance_task_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER attendance_tasks_audit
AFTER INSERT OR UPDATE OR DELETE ON public.attendance_tasks
FOR EACH ROW EXECUTE FUNCTION public.attendance_audit();

CREATE TRIGGER attendance_tasks_updated_at
BEFORE UPDATE ON public.attendance_tasks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
