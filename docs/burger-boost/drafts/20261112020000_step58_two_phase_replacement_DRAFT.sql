-- =====================================================================
-- DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED
-- FLAMIO Burger Boost — Step 58: Two-Phase Reward Start (Policy 2)
-- Replacement for the unapplied Step 53 draft
--   (20261112000000_step53_reward_attempts_allocations_DRAFT.sql).
-- Apply AT MOST ONE of the two drafts; this one supersedes Step 53.
--
-- TEST project only (avwrptztixaketchgmsh). NEVER run on Production
-- (psckjmopvxaqvroaltfu). Lives outside supabase/migrations on purpose.
-- Nothing in this repository executes this file.
--
-- Verified against: supabase/migrations/20261104000000_burger_boost_isolated.sql
--   schema burger_boost AUTHORIZATION burger_boost_owner (NOLOGIN role)
--   tables settings, sessions, coupons, redemptions, audit_log (RLS on,
--   REVOKE ALL incl. service_role, no policies), 4 SECURITY DEFINER RPCs
--   owned by burger_boost_owner, EXECUTE to service_role only.
--
-- RELEASE LOCKS PRESERVED — not dropped, altered or bypassed:
--   bb_settings_game_locked      CHECK (game_enabled = false)
--   bb_sessions_discount_locked  CHECK (awarded_discount_percent = 0)
--   bb_coupons_phase1_locked     CHECK (false)
--   app code: checkoutEnabled: false (unchanged; not touched by SQL)
-- This draft inserts NO coupon and reserves NO winner slot while locked.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. PREFLIGHT (aborts the whole transaction on any mismatch)
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  ns  oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  own oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
BEGIN
  IF ns IS NULL OR own IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'BB58 preflight: schema / burger_boost_owner / service_role missing';
  END IF;
  IF NOT pg_catalog.pg_has_role(current_user, 'burger_boost_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'BB58 preflight: % cannot SET ROLE burger_boost_owner', current_user;
  END IF;
  IF (SELECT relowner FROM pg_catalog.pg_class WHERE relnamespace = ns AND relname = 'sessions') <> own
     OR (SELECT relowner FROM pg_catalog.pg_class WHERE relnamespace = ns AND relname = 'settings') <> own THEN
    RAISE EXCEPTION 'BB58 preflight: sessions/settings not owned by burger_boost_owner';
  END IF;
  -- Release locks must exist exactly as in the base migration.
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = ns
      AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked')) <> 3 THEN
    RAISE EXCEPTION 'BB58 preflight: release lock constraint missing';
  END IF;
  -- Constraints this draft replaces must exist under their verified names.
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = ns
      AND conname IN ('bb_sessions_status_check','bb_sessions_completion_consistency','bb_sessions_window_75s')) <> 3 THEN
    RAISE EXCEPTION 'BB58 preflight: expected sessions constraints not found';
  END IF;
  -- Step 53 draft must NOT have been applied (no overlapping objects).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = ns
             AND relname IN ('daily_reward_attempts','daily_allocations'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                WHERE c.relnamespace = ns AND c.relname = 'sessions'
                  AND a.attname IN ('mode','final_meter','allocated_tier','prepared_at','ack_deadline_at','ack_at')
                  AND NOT a.attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = ns
                AND proname IN ('create_mode_session','complete_reward_session','prepare_reward_session',
                                'acknowledge_reward_start','create_practice_session','expire_prepared_sessions')) THEN
    RAISE EXCEPTION 'BB58 preflight: Step 53/58 objects already present';
  END IF;
  -- Existing rows must all be legacy v1 (verified in Step 56 audit).
  IF EXISTS (SELECT 1 FROM burger_boost.sessions WHERE rules_version <> 1) THEN
    RAISE EXCEPTION 'BB58 preflight: non-v1 session rows exist';
  END IF;
END
$preflight$;

-- All new objects are created as the schema owner (owner = definer).
SET LOCAL ROLE burger_boost_owner;

-- ---------------------------------------------------------------------
-- 1. SESSIONS: mode, two-phase timestamps, prepared status
--    Historical rows: mode defaults to 'legacy', status unchanged,
--    started_at/expires_at keep their values. No row is rewritten.
-- ---------------------------------------------------------------------
ALTER TABLE burger_boost.sessions
  ADD COLUMN mode            pg_catalog.text NOT NULL DEFAULT 'legacy',
  ADD COLUMN final_meter     pg_catalog.int4,
  ADD COLUMN allocated_tier  pg_catalog.text,
  ADD COLUMN prepared_at     pg_catalog.timestamptz,
  ADD COLUMN ack_deadline_at pg_catalog.timestamptz,
  ADD COLUMN ack_at          pg_catalog.timestamptz;

-- A prepared session has no official start yet: started_at/expires_at NULL.
-- (Column DEFAULT pg_catalog.now() on started_at is dropped so a prepared
-- row cannot silently receive a start time.)
ALTER TABLE burger_boost.sessions
  ALTER COLUMN started_at DROP DEFAULT,
  ALTER COLUMN started_at DROP NOT NULL,
  ALTER COLUMN expires_at DROP NOT NULL;

ALTER TABLE burger_boost.sessions
  DROP CONSTRAINT bb_sessions_status_check,
  DROP CONSTRAINT bb_sessions_completion_consistency,
  DROP CONSTRAINT bb_sessions_window_75s;

ALTER TABLE burger_boost.sessions
  ADD CONSTRAINT bb_sessions_status_check CHECK (
    status IN ('prepared','in_progress','completed','expired','rejected')),
  -- Same rule as base for the 4 original statuses; 'prepared' joins the NULL group.
  ADD CONSTRAINT bb_sessions_completion_consistency CHECK (
    (status = 'completed'
       AND verified_score IS NOT NULL AND telemetry_hash IS NOT NULL AND completed_at IS NOT NULL)
    OR
    (status IN ('prepared','in_progress','expired','rejected')
       AND verified_score IS NULL AND telemetry_hash IS NULL AND completed_at IS NULL)),
  -- 75 s absolute cutoff whenever an official start exists (identical to base).
  ADD CONSTRAINT bb_sessions_window_75s CHECK (
    (started_at IS NULL AND expires_at IS NULL)
    OR (started_at IS NOT NULL AND expires_at = started_at + pg_catalog.make_interval(secs => 75))),
  -- Only a reward session that was never acknowledged may lack a start.
  ADD CONSTRAINT bb_sessions_start_presence CHECK (
    started_at IS NOT NULL
    OR (mode = 'reward' AND status IN ('prepared','expired') AND ack_at IS NULL)),
  ADD CONSTRAINT bb_sessions_mode_check CHECK (mode IN ('legacy','practice','reward')),
  ADD CONSTRAINT bb_sessions_mode_rules CHECK (
    (mode = 'legacy' AND rules_version = 1) OR (mode IN ('practice','reward') AND rules_version = 2)),
  ADD CONSTRAINT bb_sessions_prepare_fields CHECK (
    (mode = 'reward'
       AND prepared_at IS NOT NULL
       AND ack_deadline_at = prepared_at + pg_catalog.make_interval(secs => 15)
       AND (ack_at IS NULL OR (ack_at <= ack_deadline_at AND started_at = ack_at)))
    OR (mode <> 'reward' AND prepared_at IS NULL AND ack_deadline_at IS NULL AND ack_at IS NULL)),
  ADD CONSTRAINT bb_sessions_prepared_unacked CHECK (status <> 'prepared' OR ack_at IS NULL),
  ADD CONSTRAINT bb_sessions_alloc_tier CHECK (
    allocated_tier IS NULL OR (allocated_tier IN ('full','partial') AND mode = 'reward' AND status = 'completed'));

-- ---------------------------------------------------------------------
-- 2. SETTINGS: owner reward controls (all default 0 = nothing on)
-- ---------------------------------------------------------------------
ALTER TABLE burger_boost.settings
  ADD COLUMN owner_max_discount   pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN partial_max_discount pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN daily_full_limit     pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN daily_partial_limit  pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN min_order_bdt        pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD CONSTRAINT bb_settings_owner_max   CHECK (owner_max_discount BETWEEN 0 AND 50),
  ADD CONSTRAINT bb_settings_partial_max CHECK (partial_max_discount BETWEEN 0 AND owner_max_discount),
  ADD CONSTRAINT bb_settings_limits      CHECK (daily_full_limit BETWEEN 0 AND 1000
                                                AND daily_partial_limit BETWEEN 0 AND 1000),
  ADD CONSTRAINT bb_settings_mov         CHECK (min_order_bdt BETWEEN 0 AND 100000);

-- ---------------------------------------------------------------------
-- 3. DAILY REWARD ATTEMPTS — claimed ONLY at acknowledgement
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.daily_reward_attempts (
  user_id    pg_catalog.uuid        NOT NULL,
  dhaka_date pg_catalog.date        NOT NULL,
  session_id pg_catalog.uuid        NOT NULL,
  claimed_at pg_catalog.timestamptz NOT NULL,
  CONSTRAINT bb_attempts_pkey        PRIMARY KEY (user_id, dhaka_date),
  CONSTRAINT bb_attempts_session_key UNIQUE (session_id),
  CONSTRAINT bb_attempts_session_fk  FOREIGN KEY (session_id)
    REFERENCES burger_boost.sessions(id) ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- 4. DAILY ALLOCATIONS — one counter row per Dhaka day
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.daily_allocations (
  dhaka_date         pg_catalog.date        NOT NULL,
  full_slots_used    pg_catalog.int4        NOT NULL DEFAULT 0,
  partial_slots_used pg_catalog.int4        NOT NULL DEFAULT 0,
  updated_at         pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_alloc_pkey   PRIMARY KEY (dhaka_date),
  CONSTRAINT bb_alloc_nonneg CHECK (full_slots_used >= 0 AND partial_slots_used >= 0)
);

REVOKE ALL ON TABLE burger_boost.daily_reward_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.daily_allocations     FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.daily_reward_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.daily_allocations     ENABLE ROW LEVEL SECURITY;
-- No policies: only the owner-owned SECURITY DEFINER RPCs below touch them.
-- Owner (table owner) bypasses RLS; FORCE RLS is intentionally not set,
-- matching the base migration.

-- ---------------------------------------------------------------------
-- 5. RPC: lazy expiry of a user's unacknowledged prepared sessions
--    Only status 'prepared' rows past ack_deadline_at; never touches
--    daily_reward_attempts; rows are kept (audit evidence), not deleted.
-- ---------------------------------------------------------------------
CREATE FUNCTION burger_boost.expire_prepared_sessions(p_user_id pg_catalog.uuid)
RETURNS pg_catalog.int4
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE v_n pg_catalog.int4;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;
  UPDATE burger_boost.sessions s
     SET status = 'expired', updated_at = pg_catalog.now()
   WHERE s.user_id = p_user_id
     AND s.mode = 'reward'
     AND s.status = 'prepared'
     AND pg_catalog.now() > s.ack_deadline_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;

-- ---------------------------------------------------------------------
-- 6. RPC: PHASE 1 — PREPARE (no attempt, no slot, no coupon)
--
-- Caller: server-only (service_role) after JWT verification; p_user_id is
-- the JWT subject, never a client field. p_id / p_seed are generated by the
-- server core (same convention as base create_session). The gate track is
-- NOT stored: it is regenerated deterministically from (seed, rules_version=2)
-- and sanitized server-side (correctLane stripped) before reaching the client.
--
-- Concurrency: pg_advisory_xact_lock keyed by user UUID.
--   key = pg_catalog.hashtextextended('bb58:reward:' || user_id, 0)  (int8)
--   Collision of two different users' keys only serializes those two calls
--   briefly; it can never merge their data (all reads filter by user_id).
--   Released automatically at transaction end. No global lock.
-- Results (jsonb): {result:'prepared'|'existing_prepared'|'attempt_already_used'|'invalid'}
-- ---------------------------------------------------------------------
CREATE FUNCTION burger_boost.prepare_reward_session(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_seed    pg_catalog.int8
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now  pg_catalog.timestamptz := pg_catalog.now();
  v_day  pg_catalog.date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
  e      record;
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bb58:reward:' || p_user_id::pg_catalog.text, 0));

  -- Lazy cleanup of this user's stale prepared rows (inside the lock).
  PERFORM burger_boost.expire_prepared_sessions(p_user_id);

  -- UX pre-check (re-done under the lock). NOT the enforcement point:
  -- enforcement is the PK insert in acknowledge_reward_start.
  IF EXISTS (SELECT 1 FROM burger_boost.daily_reward_attempts a
             WHERE a.user_id = p_user_id AND a.dhaka_date = v_day) THEN
    RETURN pg_catalog.jsonb_build_object('result','attempt_already_used','dhaka_date',v_day);
  END IF;

  -- Return an existing valid prepared session instead of creating another.
  SELECT s.id, s.seed, s.prepared_at, s.ack_deadline_at INTO e
    FROM burger_boost.sessions s
   WHERE s.user_id = p_user_id AND s.mode = 'reward' AND s.status = 'prepared'
     AND v_now <= s.ack_deadline_at
   ORDER BY s.prepared_at DESC
   LIMIT 1;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result','existing_prepared','session_id',e.id,
      'seed',e.seed,'rules_version',2,'prepared_at',e.prepared_at,'ack_deadline_at',e.ack_deadline_at);
  END IF;

  INSERT INTO burger_boost.sessions
    (id, user_id, idempotency_key, status, seed, started_at, expires_at,
     completed_at, telemetry_hash, verified_score, awarded_discount_percent,
     rules_version, mode, prepared_at, ack_deadline_at, ack_at)
  VALUES
    (p_id, p_user_id, p_id::pg_catalog.text, 'prepared', p_seed, NULL, NULL,
     NULL, NULL, NULL, 0,
     2, 'reward', v_now, v_now + pg_catalog.make_interval(secs => 15), NULL);
  -- A duplicate p_id/idempotency_key raises unique_violation (not caught):
  -- that is a server bug, not an "attempt used" condition.

  RETURN pg_catalog.jsonb_build_object('result','prepared','session_id',p_id,'seed',p_seed,
    'rules_version',2,'prepared_at',v_now,'ack_deadline_at',v_now + pg_catalog.make_interval(secs => 15));
END
$fn$;

-- ---------------------------------------------------------------------
-- 7. RPC: PHASE 2 — ACKNOWLEDGE (atomic attempt claim + official start)
--
-- Lock order (same in every RPC that touches these rows, so no deadlock):
--   (1) per-user advisory xact lock → (2) sessions row FOR UPDATE
--   → (3) daily_reward_attempts PK insert.
-- Results (jsonb): started | already_started (idempotent retry) |
--   attempt_already_used | ack_expired | not_found | not_reward |
--   invalid_state | integrity_violation
-- ---------------------------------------------------------------------
CREATE FUNCTION burger_boost.acknowledge_reward_start(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now   pg_catalog.timestamptz := pg_catalog.now();
  v_day   pg_catalog.date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
  s       burger_boost.sessions%ROWTYPE;
  v_claim pg_catalog.uuid;
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
    -- Same answer for "absent" and "another user's": nothing leaks.
    RETURN pg_catalog.jsonb_build_object('result','not_found');
  END IF;
  IF s.mode <> 'reward' THEN
    RETURN pg_catalog.jsonb_build_object('result','not_reward');
  END IF;

  -- Idempotent retry after a lost response: return the durable original.
  IF s.status IN ('in_progress','completed') AND s.ack_at IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM burger_boost.daily_reward_attempts a
                   WHERE a.session_id = s.id AND a.user_id = p_user_id) THEN
      RETURN pg_catalog.jsonb_build_object('result','integrity_violation'); -- fail closed
    END IF;
    RETURN pg_catalog.jsonb_build_object('result','already_started','session_id',s.id,
      'status',s.status,'started_at',s.started_at,'expires_at',s.expires_at);
  END IF;

  IF s.status <> 'prepared' THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid_state','status',s.status);
  END IF;

  IF v_now > s.ack_deadline_at THEN
    UPDATE burger_boost.sessions SET status = 'expired', updated_at = v_now
     WHERE id = s.id AND status = 'prepared';
    RETURN pg_catalog.jsonb_build_object('result','ack_expired');
  END IF;

  -- Atomic, conflict-safe claim. Only the (user_id, dhaka_date) PK conflict
  -- is absorbed; any other error (FK, session_id unique) propagates.
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
    RAISE EXCEPTION 'BB58 ack: session state changed under lock' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object('result','started','session_id',s.id,'seed',s.seed,
    'rules_version',2,'started_at',v_now,'expires_at',v_now + pg_catalog.make_interval(secs => 75),
    'dhaka_date',v_day);
END
$fn$;

-- ---------------------------------------------------------------------
-- 8. RPC: PRACTICE session (unlimited; no ack, attempt, slot or coupon)
-- ---------------------------------------------------------------------
CREATE FUNCTION burger_boost.create_practice_session(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid,
  p_seed    pg_catalog.int8
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE v_now pg_catalog.timestamptz := pg_catalog.now();
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid');
  END IF;
  INSERT INTO burger_boost.sessions
    (id, user_id, idempotency_key, status, seed, started_at, expires_at,
     awarded_discount_percent, rules_version, mode)
  VALUES
    (p_id, p_user_id, p_id::pg_catalog.text, 'in_progress', p_seed, v_now,
     v_now + pg_catalog.make_interval(secs => 75), 0, 2, 'practice');
  RETURN pg_catalog.jsonb_build_object('result','started','session_id',p_id,'seed',p_seed,
    'rules_version',2,'started_at',v_now,'expires_at',v_now + pg_catalog.make_interval(secs => 75));
END
$fn$;

-- ---------------------------------------------------------------------
-- 9. RPC: reward completion + Full/Partial allocation design
--    p_final_meter comes from server replay (replayDiscountMeter), never
--    from the client. Completion time = database time.
--    Counter init race-free: INSERT ... ON CONFLICT DO NOTHING, then
--    SELECT ... FOR UPDATE serializes all finishers of that Dhaka day.
--    Allocation day = Dhaka date of the official started_at.
--    While v_issuance_unlocked = false NO slot is reserved and NO coupon
--    is written. Coupon insertion is BLOCKED — NOT IMPLEMENTED: it needs
--    a release migration that removes bb_coupons_phase1_locked (Owner).
-- ---------------------------------------------------------------------
CREATE FUNCTION burger_boost.complete_reward_session(
  p_id             pg_catalog.uuid,
  p_user_id        pg_catalog.uuid,
  p_final_meter    pg_catalog.int4,
  p_telemetry_hash pg_catalog.text
) RETURNS pg_catalog.jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_now  pg_catalog.timestamptz := pg_catalog.now();
  s      burger_boost.sessions%ROWTYPE;
  cfg    burger_boost.settings%ROWTYPE;
  a      burger_boost.daily_allocations%ROWTYPE;
  v_day  pg_catalog.date;
  v_m    pg_catalog.int4;
  v_full pg_catalog.int4;
  v_part pg_catalog.int4;
  v_tier pg_catalog.text := NULL;
  v_issuance_unlocked pg_catalog.bool := false; -- flips only in an approved release migration
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_final_meter IS NULL
     OR p_telemetry_hash IS NULL OR p_telemetry_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN pg_catalog.jsonb_build_object('result','invalid');
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bb58:reward:' || p_user_id::pg_catalog.text, 0));

  SELECT * INTO s FROM burger_boost.sessions
   WHERE id = p_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR s.mode <> 'reward' OR s.status <> 'in_progress' THEN
    RETURN pg_catalog.jsonb_build_object('result','not_eligible');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM burger_boost.daily_reward_attempts x
                 WHERE x.session_id = s.id AND x.user_id = p_user_id) THEN
    RETURN pg_catalog.jsonb_build_object('result','integrity_violation');
  END IF;
  IF v_now > s.expires_at THEN
    UPDATE burger_boost.sessions SET status = 'expired', updated_at = v_now
     WHERE id = s.id AND status = 'in_progress';
    RETURN pg_catalog.jsonb_build_object('result','expired');
  END IF;

  v_m := LEAST(GREATEST(p_final_meter, 0), 100);
  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
  v_full := pg_catalog.floor(cfg.owner_max_discount   * v_m / 100.0)::pg_catalog.int4;
  v_part := pg_catalog.floor(cfg.partial_max_discount * v_m / 100.0)::pg_catalog.int4;

  IF p_final_meter > 0 AND v_issuance_unlocked THEN
    v_day := (s.started_at AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
    INSERT INTO burger_boost.daily_allocations (dhaka_date) VALUES (v_day)
      ON CONFLICT ON CONSTRAINT bb_alloc_pkey DO NOTHING;
    SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = v_day FOR UPDATE;
    IF a.full_slots_used < cfg.daily_full_limit AND v_full > 0 THEN
      UPDATE burger_boost.daily_allocations
         SET full_slots_used = full_slots_used + 1, updated_at = v_now WHERE dhaka_date = v_day;
      v_tier := 'full';
    ELSIF a.full_slots_used >= cfg.daily_full_limit
          AND a.partial_slots_used < cfg.daily_partial_limit AND v_part > 0 THEN
      UPDATE burger_boost.daily_allocations
         SET partial_slots_used = partial_slots_used + 1, updated_at = v_now WHERE dhaka_date = v_day;
      v_tier := 'partial';
    END IF;
    -- FUTURE (BLOCKED): coupon insert, expires_at = v_now + 7 days.
  END IF;

  -- awarded_discount_percent stays 0 (bb_sessions_discount_locked).
  UPDATE burger_boost.sessions
     SET status = 'completed', verified_score = GREATEST(p_final_meter, 0),
         final_meter = p_final_meter, telemetry_hash = p_telemetry_hash,
         completed_at = v_now, allocated_tier = v_tier, updated_at = v_now
   WHERE id = s.id AND status = 'in_progress';

  RETURN pg_catalog.jsonb_build_object(
    'result', COALESCE(v_tier, CASE WHEN p_final_meter <= 0 THEN 'loss'
                                    WHEN v_issuance_unlocked THEN 'none'
                                    ELSE 'release_locked' END),
    'final_meter', p_final_meter,
    'preview_full_discount', v_full,
    'preview_partial_discount', v_part,
    'awarded_discount_percent', 0);
END
$fn$;

-- ---------------------------------------------------------------------
-- 10. OWNERSHIP + GRANTS (explicit, even though SET LOCAL ROLE applies)
-- ---------------------------------------------------------------------
ALTER FUNCTION burger_boost.expire_prepared_sessions(pg_catalog.uuid) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) OWNER TO burger_boost_owner;
ALTER FUNCTION burger_boost.complete_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text) OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.daily_reward_attempts OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.daily_allocations     OWNER TO burger_boost_owner;

REVOKE ALL ON FUNCTION burger_boost.expire_prepared_sessions(pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.complete_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION burger_boost.expire_prepared_sessions(pg_catalog.uuid) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.prepare_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.acknowledge_reward_start(pg_catalog.uuid, pg_catalog.uuid) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.create_practice_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.complete_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text) TO service_role;

RESET ROLE;

-- ---------------------------------------------------------------------
-- 11. POSTFLIGHT (inside the transaction; any failure rolls back all)
-- ---------------------------------------------------------------------
DO $postflight$
DECLARE
  ns  oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  own oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  svc oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role');
  f   record;
  r   record;
BEGIN
  -- Release locks still present and unchanged.
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = ns
      AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked')) <> 3 THEN
    RAISE EXCEPTION 'BB58 postflight: release lock missing';
  END IF;
  IF EXISTS (SELECT 1 FROM burger_boost.settings WHERE game_enabled)
     OR EXISTS (SELECT 1 FROM burger_boost.sessions WHERE awarded_discount_percent <> 0)
     OR EXISTS (SELECT 1 FROM burger_boost.coupons) THEN
    RAISE EXCEPTION 'BB58 postflight: lock state violated';
  END IF;
  -- Historical rows intact.
  IF EXISTS (SELECT 1 FROM burger_boost.sessions
             WHERE mode <> 'legacy' OR rules_version <> 1 OR started_at IS NULL) THEN
    RAISE EXCEPTION 'BB58 postflight: historical sessions altered';
  END IF;
  -- New tables owned + RLS, no policies.
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace = ns AND relkind = 'r'
      AND relname IN ('daily_reward_attempts','daily_allocations')
      AND relowner = own AND relrowsecurity) <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
                WHERE c.relnamespace = ns) THEN
    RAISE EXCEPTION 'BB58 postflight: table ownership/RLS/policy mismatch';
  END IF;
  -- Exactly 4 base + 5 new functions; all owner-owned definer, pinned path.
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = ns) <> 9
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = ns
                AND (proowner <> own OR NOT prosecdef
                     OR proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, burger_boost, pg_temp'])) THEN
    RAISE EXCEPTION 'BB58 postflight: function owner/definer/search_path mismatch';
  END IF;
  FOR f IN SELECT oid, proname FROM pg_catalog.pg_proc WHERE pronamespace = ns LOOP
    IF NOT pg_catalog.has_function_privilege(svc, f.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'BB58 postflight: service_role lacks EXECUTE on %', f.proname;
    END IF;
    FOR r IN SELECT oid, rolname FROM pg_catalog.pg_roles
             WHERE rolname IN ('anon','authenticated','authenticator') LOOP
      IF pg_catalog.has_function_privilege(r.oid, f.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'BB58 postflight: % has EXECUTE on %', r.rolname, f.proname;
      END IF;
    END LOOP;
  END LOOP;
  -- No table privileges for client roles or service_role on new tables.
  FOR r IN SELECT oid, rolname FROM pg_catalog.pg_roles
           WHERE rolname IN ('anon','authenticated','authenticator','service_role') LOOP
    IF pg_catalog.has_table_privilege(r.oid, 'burger_boost.daily_reward_attempts', 'SELECT,INSERT,UPDATE,DELETE')
       OR pg_catalog.has_table_privilege(r.oid, 'burger_boost.daily_allocations', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'BB58 postflight: % has table privilege on new tables', r.rolname;
    END IF;
  END LOOP;
  -- Exactly one FK in the schema (attempts → sessions). Note: the base
  -- migration's one-time postflight asserted zero FKs; this is intended.
  IF (SELECT count(*) FROM pg_catalog.pg_constraint WHERE connamespace = ns AND contype = 'f') <> 1 THEN
    RAISE EXCEPTION 'BB58 postflight: unexpected FK set';
  END IF;
END
$postflight$;

COMMIT;

-- =====================================================================
-- ROLLBACK / DESIGN NOTES (not executable instructions)
-- * Whole file is one transaction: any preflight/postflight failure
--   leaves the database exactly as before.
-- * Post-apply rollback needs a separate Owner-approved migration. It must
--   NOT delete daily_reward_attempts rows if any exist (consumed attempts
--   are never restored); restoring started_at NOT NULL requires that no
--   prepared/never-acked rows remain.
-- * Base RPCs complete_session / transition_session still accept any
--   in_progress row, including reward/practice rows. The server core must
--   route reward completion only through complete_reward_session.
--   (Tightening base RPCs = separate decision.)
-- * Base create_session still creates v1 legacy rows (mode defaults
--   'legacy'); v1 replay routing is unchanged.
-- * Server code must check started_at/expires_at nullable in the repository
--   adapter before this draft is applied (rowToRecord assumes non-null).
-- * No cron/worker: expiry is lazy (prepare, ack, complete).
-- * Advisory lock key derivation: hashtextextended(text,0) → int8; per-user,
--   transaction-scoped. Collisions only cause harmless extra waiting.
-- * IMPLEMENTED: two-phase start, attempt claim, practice, completion,
--   allocation counters (dormant). NOT IMPLEMENTED / BLOCKED: coupon insert,
--   checkout, owner settings write RPC.
-- =====================================================================
