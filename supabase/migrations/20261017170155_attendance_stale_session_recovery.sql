-- TEST-only Attendance Master: safely close sessions that exceed the configured maximum.
-- The session is capped at clock_in_at + max_session_hours, never at the later retry time.
-- The row is flagged missed_punch so an Owner can review it; no automatic attendance approval.
BEGIN;

CREATE OR REPLACE FUNCTION public.attendance_auto_close_stale_session(
  _user_id uuid,
  _max_session_hours integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_session public.attendance_sessions%ROWTYPE;
  v_cutoff timestamptz;
  v_break_minutes integer := 0;
  v_worked_minutes integer := 0;
BEGIN
  IF _user_id IS NULL OR _max_session_hours IS NULL
     OR _max_session_hours < 1 OR _max_session_hours > 24 THEN
    RAISE EXCEPTION 'Invalid stale-session recovery arguments';
  END IF;

  -- This function is intended for the trusted service-role server bridge only.
  -- A direct authenticated caller must never be able to close another user's session.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'This operation is only available to the trusted server';
  END IF;

  SELECT s.*
    INTO v_session
    FROM public.attendance_sessions AS s
   WHERE s.user_id = _user_id
     AND s.clock_out_at IS NULL
   ORDER BY s.clock_in_at DESC
   LIMIT 1
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_cutoff := v_session.clock_in_at + make_interval(hours => _max_session_hours);

  IF now() < v_cutoff THEN
    RETURN false;
  END IF;

  -- Close any break still open at the session's configured cutoff.
  UPDATE public.attendance_breaks AS b
     SET ended_at = GREATEST(b.started_at, v_cutoff),
         updated_at = now()
   WHERE b.session_id = v_session.id
     AND b.user_id = _user_id
     AND b.ended_at IS NULL;

  SELECT COALESCE(
    SUM(
      GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (
          LEAST(COALESCE(b.ended_at, v_cutoff), v_cutoff) - b.started_at
        )) / 60)::integer
      )
    ),
    0
  )::integer
    INTO v_break_minutes
    FROM public.attendance_breaks AS b
   WHERE b.session_id = v_session.id
     AND b.user_id = _user_id
     AND b.started_at < v_cutoff;

  v_worked_minutes := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (v_cutoff - v_session.clock_in_at)) / 60)::integer
      - v_break_minutes
  );

  UPDATE public.attendance_sessions
     SET clock_out_at = v_cutoff,
         clock_out_source = 'system',
         clock_out_note = 'Auto-closed at max session limit; Owner review required',
         worked_minutes = v_worked_minutes,
         break_minutes = v_break_minutes,
         status = 'missed_punch',
         flags = ARRAY(
           SELECT DISTINCT flag
             FROM unnest(COALESCE(flags, ARRAY[]::text[]) || ARRAY['missed_punch']::text[]) AS flag
         ),
         updated_at = now()
   WHERE id = v_session.id
     AND clock_out_at IS NULL;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.attendance_auto_close_stale_session(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_auto_close_stale_session(uuid, integer) TO service_role;

COMMIT;
