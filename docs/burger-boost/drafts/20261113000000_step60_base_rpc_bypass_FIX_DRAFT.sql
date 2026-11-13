-- =====================================================================
-- DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED
-- FLAMIO Burger Boost — Step 60: base RPC Reward-bypass correction
-- TEST project only (avwrptztixaketchgmsh). NEVER run on Production
-- (psckjmopvxaqvroaltfu). Lives outside supabase/migrations on purpose.
-- Nothing in this repository executes this file.
--
-- Apply ONLY together with / after the Step 58 draft (it needs the
-- sessions.mode column). Preflight aborts if mode is absent.
--
-- Change: complete_session and transition_session may only touch
-- mode IN ('legacy','practice'). Reward rows are excluded, so Reward
-- completion/expiry can only go through the Step 58 Reward RPCs.
-- 'practice' is kept because the server core finishes and expires
-- Practice games through these generic RPCs (no Practice-specific
-- completion RPC exists).
--
-- Preserved: identical signatures (CREATE OR REPLACE, no DROP),
-- SECURITY DEFINER, search_path, owner burger_boost_owner, legacy logic,
-- REVOKE ALL + EXECUTE to service_role only. Release locks untouched.
-- =====================================================================

BEGIN;

DO $preflight$
DECLARE ns oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
BEGIN
  IF ns IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
     WHERE c.relnamespace = ns AND c.relname = 'sessions' AND a.attname = 'mode' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'BB60 preflight: sessions.mode missing (Step 58 not applied)';
  END IF;
END
$preflight$;

SET LOCAL ROLE burger_boost_owner;

CREATE OR REPLACE FUNCTION burger_boost.complete_session(
  p_id             pg_catalog.uuid,
  p_user_id        pg_catalog.uuid,
  p_verified_score pg_catalog.int4,
  p_telemetry_hash pg_catalog.text,
  p_completed_at   pg_catalog.timestamptz
) RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL
     OR p_verified_score IS NULL OR p_verified_score < 0
     OR p_telemetry_hash IS NULL OR p_telemetry_hash !~ '^[0-9a-f]{64}$'
     OR p_completed_at IS NULL OR NOT pg_catalog.isfinite(p_completed_at) THEN
    RETURN false;
  END IF;

  UPDATE burger_boost.sessions s
     SET status         = 'completed',
         verified_score = p_verified_score,
         telemetry_hash = p_telemetry_hash,
         completed_at   = p_completed_at,
         updated_at     = pg_catalog.now()
   WHERE s.id = p_id
     AND s.user_id = p_user_id
     AND s.mode IN ('legacy','practice')   -- Step 60: Reward excluded
     AND s.status = 'in_progress'
     AND p_completed_at >= s.started_at
     AND p_completed_at <= s.expires_at
     AND s.expires_at = s.started_at + pg_catalog.make_interval(secs => 75);

  RETURN FOUND;
END
$fn$;

CREATE OR REPLACE FUNCTION burger_boost.transition_session(
  p_id            pg_catalog.uuid,
  p_user_id       pg_catalog.uuid,
  p_target_status pg_catalog.text
) RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL
     OR p_target_status IS NULL OR p_target_status NOT IN ('expired','rejected') THEN
    RETURN false;
  END IF;

  UPDATE burger_boost.sessions s
     SET status     = p_target_status,
         updated_at = pg_catalog.now()
   WHERE s.id = p_id
     AND s.user_id = p_user_id
     AND s.mode IN ('legacy','practice')   -- Step 60: Reward excluded
     AND s.status = 'in_progress';

  RETURN FOUND;
END
$fn$;

ALTER FUNCTION burger_boost.complete_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.transition_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) OWNER TO burger_boost_owner;
REVOKE ALL ON FUNCTION burger_boost.complete_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.transition_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION burger_boost.complete_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.transition_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) TO service_role;

RESET ROLE;

DO $postflight$
DECLARE
  ns  oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  own oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  f record;
BEGIN
  FOR f IN SELECT oid, proname, proowner, prosecdef, proconfig, pg_catalog.pg_get_functiondef(oid) AS def
             FROM pg_catalog.pg_proc WHERE pronamespace = ns AND proname IN ('complete_session','transition_session') LOOP
    IF f.proowner <> own OR NOT f.prosecdef
       OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, burger_boost, pg_temp']
       OR pg_catalog.strpos(f.def, 's.mode IN (''legacy'',''practice'')') = 0 THEN
      RAISE EXCEPTION 'BB60 postflight: % owner/definer/path/mode guard mismatch', f.proname;
    END IF;
    IF pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'BB60 postflight: % grant mismatch', f.proname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = ns
      AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked')) <> 3 THEN
    RAISE EXCEPTION 'BB60 postflight: release lock missing';
  END IF;
END
$postflight$;

COMMIT;
