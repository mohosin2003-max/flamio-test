-- FLAMIO ATTENDANCE MASTER — verified TEST function ACL release candidate
-- PRODUCTION RELEASE CANDIDATE — DO NOT APPLY YET.

-- Fail closed by default: remove direct RPC execution from PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.attendance_apply_session_times(uuid,timestamptz,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_assert_valid_window(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_audit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_auto_close_stale_session(uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_break_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_cancel_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_clear_expired_evidence_refs(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_clock_in(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_clock_out(text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_complete_task_as_service(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_consume_qr_challenge(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_end_break() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_end_break_as_service(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_is_manager(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_is_member(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_list_expired_evidence_paths(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_list_orphan_task_photo_paths(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_local_date(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_lock_task_checklist_parent() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_manager_correct_session(uuid,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_match_shift(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_minutes(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_process_duty_end_and_overtime() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_purge_old_records() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_recalculate_session(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_review_request(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_review_request_as_service(uuid,boolean,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_review_task(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_run_maintenance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_session_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_shift_compute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_start_break() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_submit_request(text,text,text,date,date,uuid,date,timestamptz,timestamptz,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_team_directory() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_toggle_task_item(uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_toggle_task_item_as_service(uuid,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_update_task_progress(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_validate_request_submission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_verify_session(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_verify_session_as_service(uuid,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attendance_verify_task_photo_cleanup_secret(text) FROM PUBLIC, anon, authenticated;

-- Exact TEST direct-execution surface.
GRANT EXECUTE ON FUNCTION public.attendance_break_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_clock_out(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_is_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_is_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_lock_task_checklist_parent() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_session_guard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_shift_compute() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_local_date(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_local_date(timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.attendance_local_date(timestamptz) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.attendance_minutes(timestamptz,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_minutes(timestamptz,timestamptz) TO anon;
GRANT EXECUTE ON FUNCTION public.attendance_minutes(timestamptz,timestamptz) TO PUBLIC;
