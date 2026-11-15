-- STEP 64L RECONCILIATION CANDIDATE — verbatim Step 64J approved draft.
-- Owner reports STEP64K was applied to TEST avwrptztixaketchgmsh, but the
-- applied function bodies and ledger version were NOT verified against this
-- text (no DB access). Kept as a draft; promote to supabase/migrations only
-- after pg_get_functiondef comparison. DO NOT RE-APPLY.
-- ============================================================================
-- FLAMIO BURGER BOOST — STEP 64J: RULES v3 SUPPORT MIGRATION
-- Environment: TEST Supabase ONLY (avwrptztixaketchgmsh)
-- Baseline: cd49334 | STRICT OWNER EXECUTION REVIEW
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: READ-ONLY PREFLIGHT AUDIT
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_ns      oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  v_owner   oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  v_locks   int;
BEGIN
  IF v_ns IS NULL THEN
    RAISE EXCEPTION 'BB64J preflight: burger_boost namespace missing';
  END IF;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'BB64J preflight: burger_boost_owner role missing';
  END IF;

  -- 1. Ensure Step 58 mode column is present
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    WHERE c.relnamespace = v_ns AND c.relname = 'sessions' AND a.attname = 'mode' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'BB64J preflight: sessions.mode missing (Step 58 prerequisite not satisfied)';
  END IF;

  -- 2. Verify all three release locks are active
  SELECT count(*) INTO v_locks
    FROM pg_catalog.pg_constraint
   WHERE connamespace = v_ns
     AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked');
  IF v_locks <> 3 THEN
    RAISE EXCEPTION 'BB64J preflight: release locks missing or modified (found % of 3)', v_locks;
  END IF;

  -- 3. Verify get_session_for_user has no dependent database objects before dropping
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_proc p ON p.oid = d.objid
    WHERE p.pronamespace = v_ns AND p.proname = 'get_session_for_user'
      AND d.deptype = 'n'
  ) THEN
    RAISE EXCEPTION 'BB64J preflight: get_session_for_user has unexpected internal dependencies';
  END IF;
END
$preflight$;

SET LOCAL ROLE burger_boost_owner;

-- ----------------------------------------------------------------------------
-- PART B: SCHEMA CONSTRAINT UPDATE (ENABLE v3 IN SESSIONS TABLE)
-- ----------------------------------------------------------------------------
ALTER TABLE burger_boost.sessions
  DROP CONSTRAINT bb_sessions_mode_rules,
  ADD CONSTRAINT bb_sessions_mode_rules CHECK (
    (mode = 'legacy' AND rules_version = 1)
    OR
    (mode IN ('practice','reward') AND rules_version IN (2, 3))
  );

-- ----------------------------------------------------------------------------
-- PART C: FUNCTION REPLACEMENTS
-- ----------------------------------------------------------------------------

-- RPC 1: get_session_for_user (Drop & Recreate for 16-column + text seed return)
DROP FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid);

CREATE FUNCTION burger_boost.get_session_for_user(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid
) RETURNS TABLE (
  id                       pg_catalog.uuid,
  user_id                  pg_catalog.uuid,
  idempotency_key          pg_catalog.text,
  status                   pg_catalog.text,
  seed                     pg_catalog.text,
  started_at               pg_catalog.timestamptz,
  expires_at               pg_catalog.timestamptz,
  completed_at             pg_catalog.timestamptz,
  verified_score           pg_catalog.int4,
  telemetry_hash           pg_catalog.text,
  awarded_discount_percent pg_catalog.numeric,
  rules_version            pg_catalog.int2,
  mode                     pg_catalog.text,
  prepared_at              pg_catalog.timestamptz,
  ack_deadline_at          pg_catalog.timestamptz,
  ack_at                   pg_catalog.timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
  SELECT s.id,
         s.user_id,
         s.idempotency_key,
         s.status,
         s.seed::pg_catalog.text,
         s.started_at,
         s.expires_at,
         s.completed_at,
         s.verified_score,
         s.telemetry_hash,
         s.awarded_discount_percent,
         s.rules_version,
         s.mode,
         s.prepared_at,
         s.ack_deadline_at,
         s.ack_at
    FROM burger_boost.sessions s
   WHERE s.id = p_id
     AND s.user_id = p_user_id;
$fn$;


-- RPC 2: create_session (Preserves canonical 7-arg signature, reordered retry)
CREATE OR REPLACE FUNCTION burger_boost.create_session(
  p_id              pg_catalog.uuid,
  p_user_id         pg_catalog.uuid,
  p_seed            pg_catalog.int8,
  p_rules_version   pg_catalog.int2,
  p_idempotency_key pg_catalog.text,
  p_started_at      pg_catalog.timestamptz,
  p_expires_at      pg_catalog.timestamptz
) RETURNS pg_catalog.uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_id   pg_catalog.uuid;
  v_mode pg_catalog.text;
  v_now  pg_catalog.timestamptz := pg_catalog.now();
  e      burger_boost.sessions%ROWTYPE;
BEGIN
  -- Basic input validation
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL OR p_rules_version IS NULL
     OR p_rules_version NOT IN (1, 2, 3)
     OR p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) = 0
     OR p_started_at IS NULL OR p_expires_at IS NULL
     OR NOT pg_catalog.isfinite(p_started_at) OR NOT pg_catalog.isfinite(p_expires_at) THEN
    RAISE EXCEPTION 'BB create_session: invalid input' USING ERRCODE = '22023';
  END IF;

  -- Determine mode from rules_version (Reward sessions must use prepare_reward_session)
  IF p_rules_version = 1 THEN
    v_mode := 'legacy';
  ELSE
    v_mode := 'practice';
  END IF;

  -- Check for existing idempotency key before drift checks (safe retry)
  SELECT * INTO e
    FROM burger_boost.sessions s
   WHERE s.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF e.id = p_id
       AND e.user_id = p_user_id
       AND e.seed = p_seed
       AND e.rules_version = p_rules_version
       AND e.started_at = p_started_at
       AND e.expires_at = p_expires_at
       AND e.mode = v_mode THEN
      RETURN e.id;
    END IF;
    RAISE EXCEPTION 'BB create_session: idempotency key conflict' USING ERRCODE = 'P0001';
  END IF;

  -- Validate timing constraints for genuinely new sessions
  IF pg_catalog.abs(pg_catalog.extract(epoch FROM (p_started_at - v_now))) > 30.0
     OR p_expires_at <> p_started_at + pg_catalog.make_interval(secs => 75) THEN
    RAISE EXCEPTION 'BB create_session: invalid timestamp window' USING ERRCODE = '22023';
  END IF;

  -- Atomic insert with conflict recovery
  BEGIN
    INSERT INTO burger_boost.sessions
      (id, user_id, idempotency_key, status, seed, started_at, expires_at,
       completed_at, telemetry_hash, verified_score, awarded_discount_percent,
       rules_version, mode)
    VALUES
      (p_id, p_user_id, p_idempotency_key, 'in_progress', p_seed, p_started_at, p_expires_at,
       NULL, NULL, NULL, 0,
       p_rules_version, v_mode)
    RETURNING burger_boost.sessions.id INTO v_id;

    RETURN v_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Re-read strictly on idempotency key
      SELECT * INTO e
        FROM burger_boost.sessions s
       WHERE s.idempotency_key = p_idempotency_key;

      IF FOUND THEN
        IF e.id = p_id
           AND e.user_id = p_user_id
           AND e.seed = p_seed
           AND e.rules_version = p_rules_version
           AND e.started_at = p_started_at
           AND e.expires_at = p_expires_at
           AND e.mode = v_mode THEN
          RETURN e.id;
        END IF;
        RAISE EXCEPTION 'BB create_session: idempotency key conflict' USING ERRCODE = 'P0001';
      END IF;

      -- If idempotency_key was not found, collision was on PK (id)
      RAISE EXCEPTION 'BB create_session: primary key collision' USING ERRCODE = '23505';
  END;
END
$fn$;


-- RPC 3: create_practice_session (Preserves canonical 3-arg signature, safe retry)
CREATE OR REPLACE FUNCTION burger_boost.create_practice_session(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_seed    pg_catalog.int8
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now pg_catalog.timestamptz := pg_catalog.now();
  e     burger_boost.sessions%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid');
  END IF;

  BEGIN
    INSERT INTO burger_boost.sessions
      (id, user_id, idempotency_key, status, seed, started_at, expires_at,
       awarded_discount_percent, rules_version, mode)
    VALUES
      (p_id, p_user_id, p_id::pg_catalog.text, 'in_progress', p_seed, v_now,
       v_now + pg_catalog.make_interval(secs => 75), 0, 3, 'practice');

    RETURN pg_catalog.jsonb_build_object(
      'result','started',
      'session_id',p_id,
      'seed',p_seed,
      'rules_version',3,
      'started_at',v_now,
      'expires_at',v_now + pg_catalog.make_interval(secs => 75)
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- Re-read strictly on PK (id)
      SELECT * INTO e
        FROM burger_boost.sessions s
       WHERE s.id = p_id;

      IF FOUND THEN
        IF e.user_id = p_user_id
           AND e.mode = 'practice'
           AND e.seed = p_seed
           AND e.rules_version = 3
           AND e.status IN ('in_progress','completed','expired') THEN
          -- Return the original session's durable timestamps
          RETURN pg_catalog.jsonb_build_object(
            'result','started',
            'session_id',e.id,
            'seed',e.seed,
            'rules_version',e.rules_version,
            'started_at',e.started_at,
            'expires_at',e.expires_at
          );
        END IF;
      END IF;

      -- Unreconciled collision or foreign ownership fails closed
      RETURN pg_catalog.jsonb_build_object('result','conflict');
  END;
END
$fn$;


-- RPC 4: prepare_reward_session (Preserves canonical 3-arg signature, v3 preparation)
CREATE OR REPLACE FUNCTION burger_boost.prepare_reward_session(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_seed    pg_catalog.int8
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now pg_catalog.timestamptz := pg_catalog.now();
  v_day pg_catalog.date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
  e     record;
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bb58:reward:' || p_user_id::pg_catalog.text, 0));

  -- Clean up stale prepared rows
  PERFORM burger_boost.expire_prepared_sessions(p_user_id);

  -- UX pre-check
  IF EXISTS (SELECT 1 FROM burger_boost.daily_reward_attempts a
             WHERE a.user_id = p_user_id AND a.dhaka_date = v_day) THEN
    RETURN pg_catalog.jsonb_build_object('result','attempt_already_used','dhaka_date',v_day);
  END IF;

  -- Reuse existing unexpired prepared session
  SELECT s.id, s.seed, s.rules_version, s.prepared_at, s.ack_deadline_at INTO e
    FROM burger_boost.sessions s
   WHERE s.user_id = p_user_id AND s.mode = 'reward' AND s.status = 'prepared'
     AND v_now <= s.ack_deadline_at
   ORDER BY s.prepared_at DESC
   LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'result','existing_prepared',
      'session_id',e.id,
      'seed',e.seed,
      'rules_version',e.rules_version,
      'prepared_at',e.prepared_at,
      'ack_deadline_at',e.ack_deadline_at
    );
  END IF;

  INSERT INTO burger_boost.sessions
    (id, user_id, idempotency_key, status, seed, started_at, expires_at,
     completed_at, telemetry_hash, verified_score, awarded_discount_percent,
     rules_version, mode, prepared_at, ack_deadline_at, ack_at)
  VALUES
    (p_id, p_user_id, p_id::pg_catalog.text, 'prepared', p_seed, NULL, NULL,
     NULL, NULL, NULL, 0,
     3, 'reward', v_now, v_now + pg_catalog.make_interval(secs => 15), NULL);

  RETURN pg_catalog.jsonb_build_object(
    'result','prepared',
    'session_id',p_id,
    'seed',p_seed,
    'rules_version',3,
    'prepared_at',v_now,
    'ack_deadline_at',v_now + pg_catalog.make_interval(secs => 15)
  );
END
$fn$;


-- RPC 5: acknowledge_reward_start (Preserves canonical 2-arg signature, durable dhaka_date)
CREATE OR REPLACE FUNCTION burger_boost.acknowledge_reward_start(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now         pg_catalog.timestamptz := pg_catalog.now();
  v_day         pg_catalog.date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
  s             burger_boost.sessions%ROWTYPE;
  v_claim       pg_catalog.uuid;
  v_attempt_day pg_catalog.date;
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result','not_found');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bb58:reward:' || p_user_id::pg_catalog.text, 0));

  SELECT * INTO s FROM burger_boost.sessions
   WHERE id = p_id AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result','not_found');
  END IF;
  IF s.mode <> 'reward' THEN
    RETURN pg_catalog.jsonb_build_object('result','not_reward');
  END IF;

  -- Idempotent retry recovery for in_progress or completed sessions
  IF s.status IN ('in_progress','completed') AND s.ack_at IS NOT NULL THEN
    SELECT a.dhaka_date INTO v_attempt_day
      FROM burger_boost.daily_reward_attempts a
     WHERE a.session_id = s.id AND a.user_id = p_user_id;

    IF NOT FOUND THEN
      RETURN pg_catalog.jsonb_build_object('result','integrity_violation');
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'result','already_started',
      'session_id',s.id,
      'status',s.status,
      'seed',s.seed,
      'rules_version',s.rules_version,
      'started_at',s.started_at,
      'expires_at',s.expires_at,
      'dhaka_date',v_attempt_day
    );
  END IF;

  IF s.status <> 'prepared' THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid_state','status',s.status);
  END IF;

  IF v_now > s.ack_deadline_at THEN
    UPDATE burger_boost.sessions SET status = 'expired', updated_at = v_now
     WHERE id = s.id AND status = 'prepared';
    RETURN pg_catalog.jsonb_build_object('result','ack_expired');
  END IF;

  -- Atomic claim of daily attempt
  INSERT INTO burger_boost.daily_reward_attempts (user_id, dhaka_date, session_id, claimed_at)
  VALUES (p_user_id, v_day, s.id, v_now)
  ON CONFLICT ON CONSTRAINT bb_attempts_pkey DO NOTHING
  RETURNING session_id INTO v_claim;

  IF v_claim IS NULL THEN
    UPDATE burger_boost.sessions SET status = 'expired', updated_at = v_now
     WHERE id = s.id AND status = 'prepared';
    RETURN pg_catalog.jsonb_build_object('result','attempt_already_used','dhaka_date',v_day);
  END IF;

  UPDATE burger_boost.sessions
     SET status     = 'in_progress',
         ack_at     = v_now,
         started_at = v_now,
         expires_at = v_now + pg_catalog.make_interval(secs => 75),
         updated_at = v_now
   WHERE id = s.id AND status = 'prepared';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BB ack: session state changed under lock' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'result','started',
    'session_id',s.id,
    'seed',s.seed,
    'rules_version',s.rules_version,
    'started_at',v_now,
    'expires_at',v_now + pg_catalog.make_interval(secs => 75),
    'dhaka_date',v_day
  );
END
$fn$;

-- ----------------------------------------------------------------------------
-- PART D: OWNERSHIP AND PERMISSIONS
-- ----------------------------------------------------------------------------
ALTER FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.create_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.int2, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.timestamptz) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) OWNER TO burger_boost_owner;

REVOKE ALL ON FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.create_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.int2, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.create_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.int2, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) TO service_role;

RESET ROLE;

-- ----------------------------------------------------------------------------
-- PART E: READ-ONLY POSTFLIGHT VERIFICATION
-- ----------------------------------------------------------------------------
DO $postflight$
DECLARE
  v_ns      oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  v_owner   oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  f         record;
  v_pass    boolean;
BEGIN
  -- 1. Check all functions have owner, definer, pinned search path, and service_role grant only
  FOR f IN
    SELECT oid, proname, proowner, prosecdef, proconfig
      FROM pg_catalog.pg_proc
     WHERE pronamespace = v_ns
       AND proname IN ('get_session_for_user','create_session','create_practice_session','prepare_reward_session','acknowledge_reward_start')
  LOOP
    IF f.proowner <> v_owner OR NOT f.prosecdef
       OR f.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, burger_boost, pg_temp'] THEN
      RAISE EXCEPTION 'BB64J postflight: % metadata mismatch', f.proname;
    END IF;
    IF pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'BB64J postflight: % grant mismatch', f.proname;
    END IF;
  END LOOP;

  -- 2. Verify get_session_for_user 16-column table schema and text seed
  WITH expected(col_index, col_name, type_name) AS (
    VALUES
      (1,  'id',                       'uuid'),
      (2,  'user_id',                  'uuid'),
      (3,  'idempotency_key',          'text'),
      (4,  'status',                   'text'),
      (5,  'seed',                     'text'),
      (6,  'started_at',               'timestamp with time zone'),
      (7,  'expires_at',               'timestamp with time zone'),
      (8,  'completed_at',             'timestamp with time zone'),
      (9,  'verified_score',           'integer'),
      (10, 'telemetry_hash',           'text'),
      (11, 'awarded_discount_percent', 'numeric'),
      (12, 'rules_version',            'smallint'),
      (13, 'mode',                     'text'),
      (14, 'prepared_at',              'timestamp with time zone'),
      (15, 'ack_deadline_at',          'timestamp with time zone'),
      (16, 'ack_at',                   'timestamp with time zone')
  ),
  actual AS (
    SELECT
      row_number() OVER (ORDER BY ord)::int AS col_index,
      u.col_name,
      u.col_type::pg_catalog.regtype::pg_catalog.text AS type_name
    FROM pg_catalog.pg_proc p,
         pg_catalog.unnest(p.proallargtypes, p.proargmodes, p.proargnames)
           WITH ORDINALITY AS u(col_type, col_mode, col_name, ord)
    WHERE p.pronamespace = v_ns
      AND p.proname = 'get_session_for_user'
      AND u.col_mode IN ('t', 'o')
  )
  SELECT (COUNT(*) = 16
          AND bool_and(a.col_name = e.col_name AND a.type_name = e.type_name)
          AND (SELECT type_name FROM actual WHERE col_name = 'seed') = 'text')
    INTO v_pass
    FROM expected e
    FULL OUTER JOIN actual a ON e.col_index = a.col_index;

  IF NOT coalesce(v_pass, false) THEN
    RAISE EXCEPTION 'BB64J postflight: get_session_for_user output table schema mismatch';
  END IF;

  -- 3. Verify all three release locks remain intact
  IF (SELECT count(*) FROM pg_catalog.pg_constraint
       WHERE connamespace = v_ns
         AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked')) <> 3 THEN
    RAISE EXCEPTION 'BB64J postflight: release lock compromised';
  END IF;
END
$postflight$;

COMMIT;
