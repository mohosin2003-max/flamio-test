-- FLAMIO ATTENDANCE MASTER — bootstrap dependency for the production release candidate
-- DO NOT APPLY TO PRODUCTION YET.
-- Exact verified TEST definition:
-- attendance_local_date(timestamptz) -> date, Asia/Dhaka.

CREATE OR REPLACE FUNCTION public.attendance_local_date(_at timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT (_at AT TIME ZONE 'Asia/Dhaka')::date;
$function$;
