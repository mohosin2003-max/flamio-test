-- Owner GPS movement report (TEST only: avwrptztixaketchgmsh)
-- Stores geofence transitions only; never stores raw coordinates.
BEGIN;

CREATE TABLE IF NOT EXISTS public.attendance_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
  station_id uuid NOT NULL REFERENCES public.attendance_stations(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('geofence_enter', 'geofence_exit', 'reentry')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  distance_from_site_m numeric(8,2) NOT NULL CHECK (distance_from_site_m >= 0),
  accuracy_m numeric(8,2) NOT NULL CHECK (accuracy_m >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_location_events_session_time_idx
  ON public.attendance_location_events(session_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS attendance_location_events_user_time_idx
  ON public.attendance_location_events(user_id, occurred_at DESC);

ALTER TABLE public.attendance_location_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.attendance_location_events FROM anon, authenticated;
GRANT SELECT ON public.attendance_location_events TO authenticated;

DROP POLICY IF EXISTS attendance_location_events_owner_read ON public.attendance_location_events;
CREATE POLICY attendance_location_events_owner_read
  ON public.attendance_location_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner'::public.app_role));

COMMIT;
