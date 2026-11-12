-- =====================================================================
-- DRAFT — NOT APPLIED — OWNER APPROVAL REQUIRED
-- FLAMIO Burger Boost — Step 53: Practice/Reward modes, daily Dhaka
-- reward attempts, atomic Full/Partial winner allocation.
--
-- TEST project only (avwrptztixaketchgmsh). NEVER run on Production.
-- This file lives outside supabase/migrations on purpose. Do not execute
-- it via SQL editor, CLI or RPC without explicit Owner approval.
--
-- Release locks are PRESERVED. This draft does NOT drop or alter:
--   bb_settings_game_locked      CHECK (game_enabled = false)
--   bb_sessions_discount_locked  CHECK (awarded_discount_percent = 0)
--   bb_coupons_phase1_locked     CHECK (false)
-- While those locks exist, complete_reward_session below reserves NO slot
-- and inserts NO coupon (see the v_issuance_unlocked guard).
--
-- Conventions mirror 20261104000000_burger_boost_isolated.sql:
-- schema-qualified pg_catalog types, REVOKE ALL, RLS on, narrow
-- SECURITY DEFINER RPCs with pinned search_path, service_role EXECUTE only.
-- =====================================================================
BEGIN;

-- 1. Session mode (legacy v1 rows get 'legacy'; never rewritten).
ALTER TABLE burger_boost.sessions
  ADD COLUMN mode pg_catalog.text NOT NULL DEFAULT 'legacy',
  ADD COLUMN final_meter pg_catalog.int4,
  ADD CONSTRAINT bb_sessions_mode_check CHECK (mode IN ('legacy','practice','reward')),
  ADD CONSTRAINT bb_sessions_mode_rules CHECK (
    (mode = 'legacy' AND rules_version = 1) OR (mode IN ('practice','reward') AND rules_version = 2)
  );

-- 2. Owner reward settings (draft defaults: nothing on until Owner sets them).
ALTER TABLE burger_boost.settings
  ADD COLUMN owner_max_discount   pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN partial_max_discount pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN daily_full_limit     pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN daily_partial_limit  pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN min_order_bdt        pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD CONSTRAINT bb_settings_owner_max   CHECK (owner_max_discount BETWEEN 0 AND 50),
  ADD CONSTRAINT bb_settings_partial_max CHECK (partial_max_discount BETWEEN 0 AND owner_max_discount),
  ADD CONSTRAINT bb_settings_limits      CHECK (daily_full_limit BETWEEN 0 AND 1000 AND daily_partial_limit BETWEEN 0 AND 1000),
  ADD CONSTRAINT bb_settings_mov         CHECK (min_order_bdt BETWEEN 0 AND 100000);

-- 3. One reward attempt per user per Asia/Dhaka day.
CREATE TABLE burger_boost.daily_reward_attempts (
  user_id    pg_catalog.uuid        NOT NULL,
  dhaka_date pg_catalog.date        NOT NULL,
  session_id pg_catalog.uuid        NOT NULL,
  created_at pg_catalog.timestamptz NOT NULL,
  CONSTRAINT bb_attempts_pkey        PRIMARY KEY (user_id, dhaka_date),
  CONSTRAINT bb_attempts_session_key UNIQUE (session_id),
  CONSTRAINT bb_attempts_session_fk  FOREIGN KEY (session_id) REFERENCES burger_boost.sessions(id) ON DELETE RESTRICT
);

-- 4. Daily winner counters (one row per Dhaka day).
CREATE TABLE burger_boost.daily_allocations (
  dhaka_date         pg_catalog.date        NOT NULL,
  full_slots_used    pg_catalog.int4        NOT NULL DEFAULT 0,
  partial_slots_used pg_catalog.int4        NOT NULL DEFAULT 0,
  updated_at         pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_alloc_pkey    PRIMARY KEY (dhaka_date),
  CONSTRAINT bb_alloc_nonneg  CHECK (full_slots_used >= 0 AND partial_slots_used >= 0)
);

-- Idempotency: one allocation per session.
ALTER TABLE burger_boost.sessions
  ADD COLUMN allocated_tier pg_catalog.text,
  ADD CONSTRAINT bb_sessions_alloc_tier CHECK (allocated_tier IS NULL OR (allocated_tier IN ('full','partial') AND mode = 'reward'));

REVOKE ALL ON TABLE burger_boost.daily_reward_attempts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.daily_allocations     FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.daily_reward_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.daily_allocations     ENABLE ROW LEVEL SECURITY;
-- No policies: only the SECURITY DEFINER RPCs below touch these tables.

-- 5. Atomic mode session creation. Order: session FIRST, then attempt, same
--    transaction. A unique conflict on the attempt rolls back the session.
--    Dhaka date is derived from the server start time, never from the client.
CREATE FUNCTION burger_boost.create_mode_session(
  p_id pg_catalog.uuid, p_user_id pg_catalog.uuid, p_seed pg_catalog.int8,
  p_mode pg_catalog.text, p_started_at pg_catalog.timestamptz
) RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $$
BEGIN
  IF p_mode NOT IN ('practice','reward') THEN RAISE EXCEPTION USING ERRCODE = '22023'; END IF;
  INSERT INTO burger_boost.sessions (id, user_id, idempotency_key, seed, started_at, expires_at, rules_version, mode)
  VALUES (p_id, p_user_id, p_id::text, p_seed, p_started_at, p_started_at + make_interval(secs => 75), 2, p_mode);
  IF p_mode = 'reward' THEN
    BEGIN
      INSERT INTO burger_boost.daily_reward_attempts (user_id, dhaka_date, session_id, created_at)
      VALUES (p_user_id, (p_started_at AT TIME ZONE 'Asia/Dhaka')::date, p_id, p_started_at);
    EXCEPTION WHEN unique_violation THEN
      -- Undo the session inserted above; caller sees "attempt already used".
      DELETE FROM burger_boost.sessions WHERE id = p_id;
      RETURN false;
    END;
  END IF;
  RETURN true;
END $$;

-- 6. Atomic reward completion. Locks session, then the day's counter row,
--    reserves at most one slot. Allocation day = session START Dhaka date.
--    While coupons are locked, NO slot is reserved (nothing can be issued).
CREATE FUNCTION burger_boost.complete_reward_session(
  p_id pg_catalog.uuid, p_user_id pg_catalog.uuid, p_final_meter pg_catalog.int4,
  p_telemetry_hash pg_catalog.text, p_completed_at pg_catalog.timestamptz
) RETURNS pg_catalog.text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $$
DECLARE
  s burger_boost.sessions%ROWTYPE;
  cfg burger_boost.settings%ROWTYPE;
  a burger_boost.daily_allocations%ROWTYPE;
  v_day pg_catalog.date;
  v_issuance_unlocked pg_catalog.bool := false; -- flips only in an approved release migration
  v_tier pg_catalog.text := NULL;
BEGIN
  SELECT * INTO s FROM burger_boost.sessions WHERE id = p_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR s.status <> 'in_progress' OR s.mode <> 'reward' THEN RETURN 'not_eligible'; END IF;
  IF p_completed_at > s.expires_at THEN RETURN 'expired'; END IF;

  IF p_final_meter > 0 AND v_issuance_unlocked THEN
    v_day := (s.started_at AT TIME ZONE 'Asia/Dhaka')::date;
    INSERT INTO burger_boost.daily_allocations (dhaka_date) VALUES (v_day) ON CONFLICT (dhaka_date) DO NOTHING;
    SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = v_day FOR UPDATE;
    SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
    IF a.full_slots_used < cfg.daily_full_limit AND floor(cfg.owner_max_discount * least(p_final_meter,100) / 100.0) > 0 THEN
      UPDATE burger_boost.daily_allocations SET full_slots_used = full_slots_used + 1, updated_at = now() WHERE dhaka_date = v_day;
      v_tier := 'full';
    ELSIF a.full_slots_used >= cfg.daily_full_limit AND a.partial_slots_used < cfg.daily_partial_limit
          AND floor(cfg.partial_max_discount * least(p_final_meter,100) / 100.0) > 0 THEN
      UPDATE burger_boost.daily_allocations SET partial_slots_used = partial_slots_used + 1, updated_at = now() WHERE dhaka_date = v_day;
      v_tier := 'partial';
    END IF;
    -- Coupon insert would go here (expires = p_completed_at + 7 days). Any
    -- failure raises and rolls back the slot update above.
  END IF;

  UPDATE burger_boost.sessions
     SET status = 'completed', verified_score = greatest(p_final_meter, 0), final_meter = p_final_meter,
         telemetry_hash = p_telemetry_hash, completed_at = p_completed_at, allocated_tier = v_tier, updated_at = now()
   WHERE id = p_id AND status = 'in_progress';
  RETURN coalesce(v_tier, CASE WHEN p_final_meter <= 0 THEN 'loss' WHEN v_issuance_unlocked THEN 'none' ELSE 'release_locked' END);
END $$;

REVOKE ALL ON FUNCTION burger_boost.create_mode_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.text, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION burger_boost.complete_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.create_mode_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.text, pg_catalog.timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.complete_reward_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) TO service_role;

-- REVIEW NOTES (open before approval):
-- * Function ownership must match burger_boost_owner as in the base migration.
-- * The existing bb_sessions_completion_consistency check is satisfied (score,
--   hash and completed_at set together).
-- * Concurrency: two simultaneous reward starts for one user serialize on the
--   attempts PK; the loser's session is deleted in its own subtransaction.
-- * Concurrent finishers serialize on the daily_allocations row lock.
COMMIT;
