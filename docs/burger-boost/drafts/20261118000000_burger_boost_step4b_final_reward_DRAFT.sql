-- ============================================================================
-- FLAMIO BURGER BOOST — STEP 4B FINAL REWARD FOUNDATION  (DRAFT — NOT APPLIED)
-- Target: TEST Supabase ONLY (avwrptztixaketchgmsh). NEVER production.
-- Kept in docs/ (not supabase/migrations) so no tooling can apply it by accident.
-- Run only after explicit Owner approval, in the SQL Editor, as burger_boost_owner.
-- Release locks stay ON: bb_coupons_phase1_locked and bb_sessions_discount_locked
-- are NOT dropped here. Rewards can be reserved in TEST only after a separate,
-- explicitly approved release step drops them.
-- Live TEST already has Step 58 objects (sessions.mode, settings.owner_max_discount,
-- daily_allocations); every change below is additive and guarded.
-- ============================================================================
BEGIN;
SET LOCAL ROLE burger_boost_owner;

-- 1. SETTINGS --------------------------------------------------------------
ALTER TABLE burger_boost.settings
  ADD COLUMN IF NOT EXISTS owner_max_discount   pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_max_discount pg_catalog.int2 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_full_limit     pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_partial_limit  pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_order_bdt        pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gate_count           pg_catalog.int2 NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS claim_expiry_minutes pg_catalog.int2 NOT NULL DEFAULT 30;
ALTER TABLE burger_boost.settings DROP CONSTRAINT IF EXISTS bb_settings_gate_count;
ALTER TABLE burger_boost.settings ADD CONSTRAINT bb_settings_gate_count CHECK (gate_count BETWEEN 10 AND 60);
ALTER TABLE burger_boost.settings DROP CONSTRAINT IF EXISTS bb_settings_claim_expiry;
ALTER TABLE burger_boost.settings ADD CONSTRAINT bb_settings_claim_expiry CHECK (claim_expiry_minutes = 30);
-- Proposed defaults (Owner can change later): full 20%, partial 10%, 5 full, 10 partial, MOV 0.
UPDATE burger_boost.settings
   SET owner_max_discount = 20, partial_max_discount = 10, daily_full_limit = 5,
       daily_partial_limit = 10, updated_at = pg_catalog.now()
 WHERE singleton_key = true AND owner_max_discount = 0 AND daily_full_limit = 0;

-- 2. DAILY ALLOCATIONS (add reservation counters) ---------------------------
CREATE TABLE IF NOT EXISTS burger_boost.daily_allocations (
  dhaka_date pg_catalog.date PRIMARY KEY,
  full_slots_used pg_catalog.int4 NOT NULL DEFAULT 0,
  partial_slots_used pg_catalog.int4 NOT NULL DEFAULT 0,
  updated_at pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE burger_boost.daily_allocations
  ADD COLUMN IF NOT EXISTS full_reserved    pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_reserved pg_catalog.int4 NOT NULL DEFAULT 0;
ALTER TABLE burger_boost.daily_allocations DROP CONSTRAINT IF EXISTS bb_alloc_reserved_nonneg;
ALTER TABLE burger_boost.daily_allocations ADD CONSTRAINT bb_alloc_reserved_nonneg
  CHECK (full_reserved >= 0 AND partial_reserved >= 0 AND full_slots_used >= 0 AND partial_slots_used >= 0);
REVOKE ALL ON TABLE burger_boost.daily_allocations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.daily_allocations ENABLE ROW LEVEL SECURITY;

-- 3. REWARD RESERVATIONS (separate table; coupons stays locked) -------------
CREATE TABLE IF NOT EXISTS burger_boost.reward_reservations (
  id               pg_catalog.uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id          pg_catalog.uuid        NOT NULL,
  session_id       pg_catalog.uuid        NOT NULL REFERENCES burger_boost.sessions(id),
  dhaka_date       pg_catalog.date        NOT NULL,
  tier             pg_catalog.text        NOT NULL CHECK (tier IN ('full','partial')),
  discount_percent pg_catalog.int2        NOT NULL CHECK (discount_percent BETWEEN 1 AND 50),
  status           pg_catalog.text        NOT NULL DEFAULT 'reserved'
                     CHECK (status IN ('reserved','redeemed','expired')),
  created_at       pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at       pg_catalog.timestamptz NOT NULL,
  redeemed_order_id pg_catalog.uuid,
  redeemed_at      pg_catalog.timestamptz,
  restored_count   pg_catalog.int2        NOT NULL DEFAULT 0 CHECK (restored_count BETWEEN 0 AND 1),
  CONSTRAINT bb_res_one_per_session UNIQUE (session_id),
  CONSTRAINT bb_res_redeem_consistency CHECK (
    (status = 'redeemed') = (redeemed_order_id IS NOT NULL AND redeemed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bb_res_user_status ON burger_boost.reward_reservations (user_id, status);
CREATE INDEX IF NOT EXISTS bb_res_open_expiry ON burger_boost.reward_reservations (expires_at) WHERE status = 'reserved';
CREATE UNIQUE INDEX IF NOT EXISTS bb_res_order ON burger_boost.reward_reservations (redeemed_order_id) WHERE redeemed_order_id IS NOT NULL;
REVOKE ALL ON TABLE burger_boost.reward_reservations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.reward_reservations ENABLE ROW LEVEL SECURITY;

-- 4. RPCs (SECURITY DEFINER, fixed search_path, service_role only) ----------
-- Lock order everywhere: daily_allocations rows by dhaka_date ASC, then reservations.

CREATE OR REPLACE FUNCTION burger_boost.expire_reward_reservations()
RETURNS pg_catalog.int4 LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE r record; n pg_catalog.int4 := 0;
BEGIN
  FOR r IN SELECT DISTINCT dhaka_date FROM burger_boost.reward_reservations
           WHERE status = 'reserved' AND expires_at <= pg_catalog.now() ORDER BY dhaka_date LOOP
    PERFORM 1 FROM burger_boost.daily_allocations WHERE dhaka_date = r.dhaka_date FOR UPDATE;
    WITH ex AS (
      UPDATE burger_boost.reward_reservations SET status = 'expired'
       WHERE dhaka_date = r.dhaka_date AND status = 'reserved' AND expires_at <= pg_catalog.now()
      RETURNING tier)
    UPDATE burger_boost.daily_allocations a
       SET full_reserved    = a.full_reserved    - (SELECT count(*) FROM ex WHERE tier = 'full'),
           partial_reserved = a.partial_reserved - (SELECT count(*) FROM ex WHERE tier = 'partial'),
           updated_at = pg_catalog.now()
     WHERE a.dhaka_date = r.dhaka_date;
    n := n + 1;
  END LOOP;
  RETURN n;
END $fn$;

CREATE OR REPLACE FUNCTION burger_boost.get_owner_settings()
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE cfg burger_boost.settings%ROWTYPE; a burger_boost.daily_allocations%ROWTYPE;
        d pg_catalog.date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
BEGIN
  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = d;
  RETURN pg_catalog.jsonb_build_object(
    'game_enabled', cfg.game_enabled, 'gate_count', cfg.gate_count,
    'owner_max_discount', cfg.owner_max_discount, 'partial_max_discount', cfg.partial_max_discount,
    'daily_full_limit', cfg.daily_full_limit, 'daily_partial_limit', cfg.daily_partial_limit,
    'min_order_bdt', cfg.min_order_bdt, 'claim_expiry_minutes', cfg.claim_expiry_minutes,
    'dhaka_date', d,
    'full_used', coalesce(a.full_slots_used, 0), 'full_reserved', coalesce(a.full_reserved, 0),
    'partial_used', coalesce(a.partial_slots_used, 0), 'partial_reserved', coalesce(a.partial_reserved, 0));
END $fn$;

-- Caller (server) verifies Owner permission challenges:edit BEFORE calling.
CREATE OR REPLACE FUNCTION burger_boost.update_settings(
  p_owner_max pg_catalog.int2, p_partial_max pg_catalog.int2, p_full_limit pg_catalog.int4,
  p_partial_limit pg_catalog.int4, p_min_order pg_catalog.int4, p_gate_count pg_catalog.int2)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
BEGIN
  IF p_owner_max NOT BETWEEN 0 AND 50 OR p_partial_max NOT BETWEEN 0 AND p_owner_max
     OR p_full_limit NOT BETWEEN 0 AND 1000 OR p_partial_limit NOT BETWEEN 0 AND 1000
     OR p_min_order NOT BETWEEN 0 AND 100000 OR p_gate_count NOT BETWEEN 10 AND 60 THEN
    RAISE EXCEPTION 'invalid settings' USING ERRCODE = '22023';
  END IF;
  UPDATE burger_boost.settings SET owner_max_discount = p_owner_max, partial_max_discount = p_partial_max,
    daily_full_limit = p_full_limit, daily_partial_limit = p_partial_limit, min_order_bdt = p_min_order,
    gate_count = p_gate_count, updated_at = pg_catalog.now() WHERE singleton_key = true;
  RETURN burger_boost.get_owner_settings();
END $fn$;

-- Idempotent per session. Meter comes from the stored, server-verified session.
CREATE OR REPLACE FUNCTION burger_boost.claim_reward_reservation(p_session_id pg_catalog.uuid, p_user_id pg_catalog.uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE s burger_boost.sessions%ROWTYPE; cfg burger_boost.settings%ROWTYPE;
        a burger_boost.daily_allocations%ROWTYPE; ex burger_boost.reward_reservations%ROWTYPE;
        d pg_catalog.date; m pg_catalog.int4; v_full pg_catalog.int4; v_part pg_catalog.int4;
        v_tier pg_catalog.text; v_pct pg_catalog.int4;
BEGIN
  SELECT * INTO s FROM burger_boost.sessions WHERE id = p_session_id AND user_id = p_user_id;
  IF NOT FOUND OR s.mode <> 'reward' OR s.status <> 'completed' THEN
    RETURN pg_catalog.jsonb_build_object('result','not_eligible'); END IF;
  SELECT * INTO ex FROM burger_boost.reward_reservations WHERE session_id = p_session_id;
  IF FOUND THEN RETURN pg_catalog.jsonb_build_object('result','existing','id',ex.id,'tier',ex.tier,
    'discount_percent',ex.discount_percent,'status',ex.status,'expires_at',ex.expires_at); END IF;
  m := LEAST(GREATEST(coalesce(s.final_meter, 0), 0), 100);
  IF m <= 0 THEN RETURN pg_catalog.jsonb_build_object('result','loss'); END IF;
  PERFORM burger_boost.expire_reward_reservations();
  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
  d := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::pg_catalog.date;
  INSERT INTO burger_boost.daily_allocations (dhaka_date) VALUES (d) ON CONFLICT DO NOTHING;
  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = d FOR UPDATE;
  v_full := pg_catalog.floor(cfg.owner_max_discount * m / 100.0)::pg_catalog.int4;
  v_part := pg_catalog.floor(cfg.partial_max_discount * m / 100.0)::pg_catalog.int4;
  IF a.full_slots_used + a.full_reserved < cfg.daily_full_limit AND v_full > 0 THEN
    v_tier := 'full'; v_pct := v_full;
    UPDATE burger_boost.daily_allocations SET full_reserved = full_reserved + 1, updated_at = pg_catalog.now() WHERE dhaka_date = d;
  ELSIF a.partial_slots_used + a.partial_reserved < cfg.daily_partial_limit AND v_part > 0 THEN
    v_tier := 'partial'; v_pct := v_part;
    UPDATE burger_boost.daily_allocations SET partial_reserved = partial_reserved + 1, updated_at = pg_catalog.now() WHERE dhaka_date = d;
  ELSE
    RETURN pg_catalog.jsonb_build_object('result','quota_exhausted');
  END IF;
  INSERT INTO burger_boost.reward_reservations (user_id, session_id, dhaka_date, tier, discount_percent, expires_at)
  VALUES (p_user_id, p_session_id, d, v_tier, v_pct, pg_catalog.now() + pg_catalog.make_interval(mins => cfg.claim_expiry_minutes))
  RETURNING * INTO ex;
  RETURN pg_catalog.jsonb_build_object('result','reserved','id',ex.id,'tier',ex.tier,
    'discount_percent',ex.discount_percent,'status',ex.status,'expires_at',ex.expires_at);
END $fn$;

CREATE OR REPLACE FUNCTION burger_boost.get_active_reward(p_user_id pg_catalog.uuid)
RETURNS pg_catalog.jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
  SELECT pg_catalog.jsonb_build_object('id',r.id,'tier',r.tier,'discount_percent',r.discount_percent,
         'expires_at',r.expires_at,'min_order_bdt',(SELECT min_order_bdt FROM burger_boost.settings WHERE singleton_key))
    FROM burger_boost.reward_reservations r
   WHERE r.user_id = p_user_id AND r.status = 'reserved' AND r.expires_at > pg_catalog.now()
   ORDER BY r.created_at DESC LIMIT 1
$fn$;

-- Called by placeOrder in the same request after the order row exists.
CREATE OR REPLACE FUNCTION burger_boost.redeem_reward(p_id pg_catalog.uuid, p_user_id pg_catalog.uuid, p_order_id pg_catalog.uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE r burger_boost.reward_reservations%ROWTYPE;
BEGIN
  SELECT * INTO r FROM burger_boost.reward_reservations WHERE id = p_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','not_found'); END IF;
  PERFORM 1 FROM burger_boost.daily_allocations WHERE dhaka_date = r.dhaka_date FOR UPDATE;
  UPDATE burger_boost.reward_reservations SET status = 'redeemed', redeemed_order_id = p_order_id, redeemed_at = pg_catalog.now()
   WHERE id = p_id AND status = 'reserved' AND expires_at > pg_catalog.now() RETURNING * INTO r;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','unavailable'); END IF;
  UPDATE burger_boost.daily_allocations SET
    full_reserved = full_reserved - (r.tier = 'full')::int, full_slots_used = full_slots_used + (r.tier = 'full')::int,
    partial_reserved = partial_reserved - (r.tier = 'partial')::int, partial_slots_used = partial_slots_used + (r.tier = 'partial')::int,
    updated_at = pg_catalog.now() WHERE dhaka_date = r.dhaka_date;
  RETURN pg_catalog.jsonb_build_object('result','redeemed','discount_percent',r.discount_percent);
END $fn$;

-- Restore once, only if the persisted order status is still placed/confirmed.
-- The order is locked FOR UPDATE so a concurrent "preparing" transition waits.
-- Restored reward keeps its identity, gets a fresh 30-minute window, counts as reserved again.
CREATE OR REPLACE FUNCTION burger_boost.restore_reward(p_order_id pg_catalog.uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, public, pg_temp AS $fn$
DECLARE st pg_catalog.text; r burger_boost.reward_reservations%ROWTYPE;
BEGIN
  SELECT status INTO st FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF st IS NULL OR st NOT IN ('placed','confirmed','cancelled') THEN
    RETURN pg_catalog.jsonb_build_object('result','not_restorable'); END IF;
  SELECT * INTO r FROM burger_boost.reward_reservations WHERE redeemed_order_id = p_order_id;
  IF NOT FOUND OR r.restored_count >= 1 THEN RETURN pg_catalog.jsonb_build_object('result','noop'); END IF;
  PERFORM 1 FROM burger_boost.daily_allocations WHERE dhaka_date = r.dhaka_date FOR UPDATE;
  UPDATE burger_boost.reward_reservations SET status = 'reserved', redeemed_order_id = NULL, redeemed_at = NULL,
         restored_count = restored_count + 1, expires_at = pg_catalog.now() + pg_catalog.make_interval(mins => 30)
   WHERE id = r.id AND status = 'redeemed';
  UPDATE burger_boost.daily_allocations SET
    full_reserved = full_reserved + (r.tier = 'full')::int, full_slots_used = full_slots_used - (r.tier = 'full')::int,
    partial_reserved = partial_reserved + (r.tier = 'partial')::int, partial_slots_used = partial_slots_used - (r.tier = 'partial')::int,
    updated_at = pg_catalog.now() WHERE dhaka_date = r.dhaka_date;
  RETURN pg_catalog.jsonb_build_object('result','restored');
END $fn$;
-- NOTE: the server must read the order status BEFORE setting it to 'cancelled'
-- and call restore_reward only when that prior persisted status was placed/confirmed.

DO $g$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'burger_boost.expire_reward_reservations()',
    'burger_boost.get_owner_settings()',
    'burger_boost.update_settings(int2,int2,int4,int4,int4,int2)',
    'burger_boost.claim_reward_reservation(uuid,uuid)',
    'burger_boost.get_active_reward(uuid)',
    'burger_boost.redeem_reward(uuid,uuid,uuid)',
    'burger_boost.restore_reward(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO burger_boost_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP; END $g$;

COMMIT;
