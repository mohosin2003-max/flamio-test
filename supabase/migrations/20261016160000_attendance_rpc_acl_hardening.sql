-- Restrict Attendance SECURITY DEFINER mutation RPCs to trusted server/database callers.
-- The application routes all attendance actions through authenticated server functions
-- using server-side authorization. Direct PostgREST RPC access could bypass additional
-- server checks (notably the GPS/QR checks in the clock-in server handler).
-- Keep helper functions used by RLS (attendance_is_manager/member, has_role) unchanged.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.attendance_cancel_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_clock_in(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_clock_out(text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_end_break() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_manager_correct_session(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_review_request(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_review_task(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_start_break() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_submit_request(text, text, text, date, date, uuid, date, timestamptz, timestamptz, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_team_directory() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_toggle_task_item(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_update_task_progress(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_verify_session(uuid, text, text) FROM PUBLIC, anon, authenticated;

COMMIT;
