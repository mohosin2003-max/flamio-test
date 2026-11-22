-- FLAMIO ATTENDANCE MASTER — normal duty auto-close + approved overtime windows
-- TEST Supabase ref avwrptztixaketchgmsh only. Production is out of scope.
-- NOT APPLIED automatically. Apply in the TEST SQL editor after review.
--
-- Policy:
--  * An open session linked to a shift closes exactly at shift.ends_at
--    (status auto_closed, source auto, note auto_closed_normal_duty_end).
--  * Overtime exists only as an APPROVED overtime request with a fixed window:
--      approved at/before duty end -> starts at duty end
--      approved after duty end     -> starts at approval time (never backdated)
--      end = start + approved minutes (30/60/90/120 only)
--  * The window closes on its own (overtime_completed_at), idempotently.
-- Existing rows, photo evidence, RLS and retention are unchanged.

BEGIN;

ALTER TABLE public.attendance_requests
  ADD COLUMN IF NOT EXISTS overtime_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS overtime_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS overtime_completed_at timestamptz;

-- New overtime requests: only the four standard durations (old rows untouched).
ALTER TABLE public.attendance_requests
  ADD CONSTRAINT attendance_requests_overtime_duration_check
  CHECK (request_type <> 'overtime' OR requested_overtime_minutes IN (30, 60, 90, 120)) NOT VALID;

ALTER TABLE public.attendance_requests
  ADD CONSTRAINT attendance_requests_overtime_window_check
  CHECK (overtime_starts_at IS NULL OR (overtime_ends_at > overtime_starts_at
         AND overtime_ends_at - overtime_starts_at <= interval '2 hours')) NOT VALID;

-- At most one approved overtime per attendance session.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_requests_one_approved_overtime_idx
  ON public.attendance_requests (session_id)
  WHERE request_type = 'overtime' AND status = 'approved' AND session_id IS NOT NULL;

-- Fix the window of one approved overtime request. Idempotent.
CREATE OR REPLACE FUNCTION public.attendance_schedule_overtime(_request_id uuid)
RETURNS public.attendance_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_req public.attendance_requests%ROWTYPE;
  v_end timestamptz;
  v_start timestamptz;
BEGIN
  SELECT * INTO v_req FROM public.attendance_requests WHERE id = _request_id FOR UPDATE;
  IF v_req.id IS NULL OR v_req.request_type <> 'overtime' OR v_req.status <> 'approved' THEN
    RAISE EXCEPTION 'Not an approved overtime request';
  END IF;
  IF v_req.overtime_starts_at IS NOT NULL THEN RETURN v_req; END IF;
  IF v_req.requested_overtime_minutes NOT IN (30, 60, 90, 120) THEN
    RAISE EXCEPTION 'Invalid overtime duration';
  END IF;
  SELECT COALESCE(sh.ends_at, s.clock_out_at, v_req.reviewed_at) INTO v_end
    FROM public.attendance_sessions s
    LEFT JOIN public.attendance_shifts sh ON sh.id = s.shift_id
   WHERE s.id = v_req.session_id;
  v_end := COALESCE(v_end, v_req.reviewed_at);
  v_start := CASE WHEN v_req.reviewed_at <= v_end THEN v_end ELSE v_req.reviewed_at END;
  UPDATE public.attendance_requests
     SET overtime_starts_at = v_start,
         overtime_ends_at = v_start + make_interval(mins => v_req.requested_overtime_minutes)
   WHERE id = v_req.id AND overtime_starts_at IS NULL
  RETURNING * INTO v_req;
  RETURN v_req;
END $fn$;

-- Minute maintenance (called by the dispatcher). Every step is conditional,
-- so repeated or concurrent runs change nothing twice.
CREATE OR REPLACE FUNCTION public.attendance_run_duty_maintenance()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_closed int := 0;
  v_scheduled int := 0;
  v_completed int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT s.id, s.user_id, sh.ends_at
      FROM public.attendance_sessions s
      JOIN public.attendance_shifts sh ON sh.id = s.shift_id
     WHERE s.clock_out_at IS NULL AND sh.ends_at <= now() AND sh.ends_at > s.clock_in_at
     FOR UPDATE OF s SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('attendance:' || r.user_id::text, 0));
    UPDATE public.attendance_breaks
       SET ended_at = GREATEST(r.ends_at, started_at + interval '1 second')
     WHERE session_id = r.id AND ended_at IS NULL;
    UPDATE public.attendance_sessions
       SET clock_out_at = r.ends_at, clock_out_source = 'auto', status = 'auto_closed',
           clock_out_note = 'auto_closed_normal_duty_end'
     WHERE id = r.id AND clock_out_at IS NULL;
    IF FOUND THEN
      PERFORM public.attendance_recalculate_session(r.id);
      -- Normal duty never produces overtime by itself.
      UPDATE public.attendance_sessions SET overtime_minutes = 0, early_leave_minutes = 0 WHERE id = r.id;
      v_closed := v_closed + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT id FROM public.attendance_requests
     WHERE request_type = 'overtime' AND status = 'approved' AND overtime_starts_at IS NULL
  LOOP
    PERFORM public.attendance_schedule_overtime(r.id);
    v_scheduled := v_scheduled + 1;
  END LOOP;

  UPDATE public.attendance_requests
     SET overtime_completed_at = overtime_ends_at
   WHERE request_type = 'overtime' AND status = 'approved'
     AND overtime_ends_at IS NOT NULL AND overtime_ends_at <= now()
     AND overtime_completed_at IS NULL;
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  RETURN jsonb_build_object('closed', v_closed, 'scheduled', v_scheduled, 'completed', v_completed);
END $fn$;

REVOKE ALL ON FUNCTION public.attendance_schedule_overtime(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attendance_run_duty_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attendance_schedule_overtime(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.attendance_run_duty_maintenance() TO service_role;

COMMIT;
