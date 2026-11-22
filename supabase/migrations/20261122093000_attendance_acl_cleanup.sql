-- FLAMIO ATTENDANCE MASTER — TEST ONLY
-- Final ACL cleanup for trigger-only helper and retired direct session-review RPC.
-- Production untouched.

REVOKE EXECUTE ON FUNCTION public.attendance_validate_request_submission()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_validate_request_submission()
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.attendance_verify_session(uuid,text,text)
  FROM PUBLIC, anon, authenticated;

-- The app now uses the service-role bridge, which independently verifies
-- Owner/Manager identity before calling the SECURITY DEFINER review function.
REVOKE EXECUTE ON FUNCTION public.attendance_verify_session_as_service(uuid,text,text,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_verify_session_as_service(uuid,text,text,uuid)
  TO service_role;
