-- ============================================================================
-- FLAMIO BURGER BOOST — STEP 4B FINAL REWARD FOUNDATION (DRAFT v4 — NOT APPLIED)
-- Target: TEST Supabase ONLY (avwrptztixaketchgmsh). NEVER production.
-- Kept in docs/ (not supabase/migrations) so no tooling applies it by accident.
-- Run only after explicit Owner approval, in the SQL Editor, as postgres.
-- NO PREFLIGHT HAS BEEN RUN. Every assertion below is unexecuted.
-- Release locks (bb_settings_game_locked, bb_sessions_discount_locked,
-- bb_coupons_phase1_locked) are asserted present and are NOT dropped.
--
-- Global lock order (every RPC):
--   1. public.orders row            (FOR UPDATE)
--   2. burger_boost.sessions row    (FOR UPDATE, claim only)
--   3. burger_boost.daily_allocations rows, dhaka_date ASC (FOR UPDATE)
--   4. burger_boost.reward_reservations row (FOR UPDATE)
--
-- Restoration policy: ONCE PER RESERVATION LIFETIME (restored_count <= 1).
--   redeem -> cancel  : order cancelled, reward restored (fresh 30 min).
--   redeem -> cancel  (second time): order cancelled, reward FORFEITED
--                       (stays redeemed against the cancelled order, slot stays used).
--   Duplicate cancel  : order already cancelled -> no-op, counters untouched.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- PART A. PREFLIGHT (read-only assertions; abort before any mutation)
-- ----------------------------------------------------------------------------
DO $preflight$
DECLARE
  v_ns oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  r record;
  v_n int;
BEGIN
  IF v_ns IS NULL THEN RAISE EXCEPTION 'BB4B preflight: schema burger_boost missing'; END IF;

  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'BB4B preflight: role burger_boost_owner missing'; END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls THEN
    RAISE EXCEPTION 'BB4B preflight: burger_boost_owner attributes not restrictive';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'BB4B preflight: service_role missing';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(nspowner) FROM pg_catalog.pg_namespace WHERE oid = v_ns) <> 'burger_boost_owner' THEN
    RAISE EXCEPTION 'BB4B preflight: schema burger_boost not owned by burger_boost_owner';
  END IF;

  -- Required columns and types
  FOR r IN SELECT * FROM (VALUES
      ('public','orders','id','uuid'), ('public','orders','user_id','uuid'),
      ('public','orders','status','text'), ('public','orders','channel','text'),
      ('burger_boost','sessions','id','uuid'), ('burger_boost','sessions','user_id','uuid'),
      ('burger_boost','sessions','mode','text'), ('burger_boost','sessions','status','text'),
      ('burger_boost','sessions','final_meter','integer'),
      ('burger_boost','settings','singleton_key','boolean'), ('burger_boost','settings','game_enabled','boolean'),
      ('burger_boost','settings','owner_max_discount','smallint'), ('burger_boost','settings','partial_max_discount','smallint'),
      ('burger_boost','settings','daily_full_limit','integer'), ('burger_boost','settings','daily_partial_limit','integer'),
      ('burger_boost','settings','min_order_bdt','integer'),
      ('burger_boost','daily_allocations','dhaka_date','date'),
      ('burger_boost','daily_allocations','full_slots_used','integer'),
      ('burger_boost','daily_allocations','partial_slots_used','integer')
    ) AS t(sch, tbl, col, typ)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = r.sch AND table_name = r.tbl AND column_name = r.col AND data_type = r.typ) THEN
      RAISE EXCEPTION 'BB4B preflight: %.%.% (%) missing or wrong type', r.sch, r.tbl, r.col, r.typ;
    END IF;
  END LOOP;

  -- burger_boost tables owned by burger_boost_owner
  FOR r IN SELECT c.relname, pg_catalog.pg_get_userbyid(c.relowner) AS own
             FROM pg_catalog.pg_class c
            WHERE c.relnamespace = v_ns AND c.relkind = 'r'
              AND c.relname IN ('settings','sessions','daily_allocations','reward_reservations') LOOP
    IF r.own <> 'burger_boost_owner' THEN
      RAISE EXCEPTION 'BB4B preflight: burger_boost.% owned by %, expected burger_boost_owner', r.relname, r.own;
    END IF;
  END LOOP;

  -- Settings singleton row exists
  SELECT count(*) INTO v_n FROM burger_boost.settings WHERE singleton_key = true;
  IF v_n <> 1 THEN RAISE EXCEPTION 'BB4B preflight: settings singleton row count is % (expected 1)', v_n; END IF;

  -- Release locks present
  SELECT count(*) INTO v_n FROM pg_catalog.pg_constraint
   WHERE connamespace = v_ns AND convalidated
     AND conname IN ('bb_settings_game_locked','bb_sessions_discount_locked','bb_coupons_phase1_locked');
  IF v_n <> 3 THEN RAISE EXCEPTION 'BB4B preflight: release locks found % of 3', v_n; END IF;

  -- public.orders RLS: must be enabled (we add a role-scoped policy; never BYPASSRLS)
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.orders'::regclass) THEN
    RAISE EXCEPTION 'BB4B preflight: public.orders RLS unexpectedly disabled';
  END IF;

  -- Existing data compatibility
  SELECT count(*) INTO v_n FROM burger_boost.daily_allocations
   WHERE full_slots_used < 0 OR partial_slots_used < 0;
  IF v_n > 0 THEN RAISE EXCEPTION 'BB4B preflight: % allocation rows have negative counters', v_n; END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = v_ns AND relname = 'reward_reservations') THEN
    EXECUTE $q$SELECT count(*) FROM burger_boost.reward_reservations r
                LEFT JOIN burger_boost.daily_allocations a USING (dhaka_date)
                WHERE a.dhaka_date IS NULL$q$ INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'BB4B preflight: % reservations reference missing allocation dates (orphans). Resolve manually; this draft never deletes data.', v_n;
    END IF;
  END IF;
END
$preflight$;

-- ----------------------------------------------------------------------------
-- PART B. MINIMUM CROSS-SCHEMA PRIVILEGES
--   burger_boost_owner needs on public.orders: SELECT (id,user_id,status,channel),
--   UPDATE (status), and row visibility through a policy scoped ONLY to itself.
--   Customer policies are unchanged. No BYPASSRLS.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO burger_boost_owner;
GRANT SELECT (id, user_id, status, channel), UPDATE (status) ON public.orders TO burger_boost_owner;

DROP POLICY IF EXISTS bb_owner_orders_select ON public.orders;
CREATE POLICY bb_owner_orders_select ON public.orders FOR SELECT TO burger_boost_owner USING (true);
DROP POLICY IF EXISTS bb_owner_orders_update ON public.orders;
CREATE POLICY bb_owner_orders_update ON public.orders FOR UPDATE TO burger_boost_owner USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA burger_boost TO service_role;

SET LOCAL ROLE burger_boost_owner;

-- ----------------------------------------------------------------------------
-- 1. SETTINGS
-- ----------------------------------------------------------------------------
ALTER TABLE burger_boost.settings
  ADD COLUMN IF NOT EXISTS gate_count           pg_catalog.int2 NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS claim_expiry_minutes pg_catalog.int2 NOT NULL DEFAULT 30;
ALTER TABLE burger_boost.settings DROP CONSTRAINT IF EXISTS bb_settings_gate_count;
ALTER TABLE burger_boost.settings ADD  CONSTRAINT bb_settings_gate_count  CHECK (gate_count BETWEEN 10 AND 60);
ALTER TABLE burger_boost.settings DROP CONSTRAINT IF EXISTS bb_settings_claim_expiry;
ALTER TABLE burger_boost.settings ADD  CONSTRAINT bb_settings_claim_expiry CHECK (claim_expiry_minutes = 30);

UPDATE burger_boost.settings
   SET owner_max_discount = 20, partial_max_discount = 10,
       daily_full_limit = 5, daily_partial_limit = 10, updated_at = pg_catalog.now()
 WHERE singleton_key = true AND owner_max_discount = 0 AND daily_full_limit = 0;

-- ----------------------------------------------------------------------------
-- 2. DAILY ALLOCATIONS
-- ----------------------------------------------------------------------------
ALTER TABLE burger_boost.daily_allocations
  ADD COLUMN IF NOT EXISTS full_reserved    pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_reserved pg_catalog.int4 NOT NULL DEFAULT 0;
ALTER TABLE burger_boost.daily_allocations DROP CONSTRAINT IF EXISTS bb_alloc_reserved_nonneg;
ALTER TABLE burger_boost.daily_allocations ADD  CONSTRAINT bb_alloc_reserved_nonneg
  CHECK (full_reserved >= 0 AND partial_reserved >= 0 AND full_slots_used >= 0 AND partial_slots_used >= 0);
REVOKE ALL ON TABLE burger_boost.daily_allocations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.daily_allocations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 3. REWARD RESERVATIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS burger_boost.reward_reservations (
  id                pg_catalog.uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  user_id           pg_catalog.uuid        NOT NULL,
  session_id        pg_catalog.uuid        NOT NULL REFERENCES burger_boost.sessions(id),
  dhaka_date        pg_catalog.date        NOT NULL,
  tier              pg_catalog.text        NOT NULL CHECK (tier IN ('full','partial')),
  discount_percent  pg_catalog.int2        NOT NULL CHECK (discount_percent BETWEEN 1 AND 50),
  status            pg_catalog.text        NOT NULL DEFAULT 'reserved'
                      CHECK (status IN ('reserved','redeemed','expired')),
  created_at        pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  expires_at        pg_catalog.timestamptz NOT NULL,
  redeemed_order_id pg_catalog.uuid,
  redeemed_at       pg_catalog.timestamptz,
  restored_count    pg_catalog.int2        NOT NULL DEFAULT 0 CHECK (restored_count BETWEEN 0 AND 1),
  CONSTRAINT bb_res_one_per_session UNIQUE (session_id),
  CONSTRAINT bb_res_redeem_consistency CHECK (
    (status = 'redeemed') = (redeemed_order_id IS NOT NULL AND redeemed_at IS NOT NULL))
);

-- FK added separately so rerunning on an existing table is idempotent.
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conname = 'bb_res_dhaka_date_fk'
                    AND conrelid = 'burger_boost.reward_reservations'::regclass) THEN
    ALTER TABLE burger_boost.reward_reservations
      ADD CONSTRAINT bb_res_dhaka_date_fk FOREIGN KEY (dhaka_date)
      REFERENCES burger_boost.daily_allocations(dhaka_date) ON DELETE RESTRICT;
  END IF;
END $fk$;

CREATE INDEX IF NOT EXISTS bb_res_user_status ON burger_boost.reward_reservations (user_id, status);
CREATE INDEX IF NOT EXISTS bb_res_open_expiry ON burger_boost.reward_reservations (expires_at) WHERE status = 'reserved';
CREATE UNIQUE INDEX IF NOT EXISTS bb_res_order ON burger_boost.reward_reservations (redeemed_order_id) WHERE redeemed_order_id IS NOT NULL;
REVOKE ALL ON TABLE burger_boost.reward_reservations FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE burger_boost.reward_reservations ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 4. RPCs
-- ----------------------------------------------------------------------------

-- Expire overdue reservations. Lock: allocation (date ASC) -> reservation rows.
CREATE OR REPLACE FUNCTION burger_boost.expire_reward_reservations()
RETURNS pg_catalog.int4 LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE d record; a burger_boost.daily_allocations%ROWTYPE;
        v_full int4; v_part int4; v_n int4; total int4 := 0;
BEGIN
  FOR d IN SELECT DISTINCT dhaka_date FROM burger_boost.reward_reservations
            WHERE status = 'reserved' AND expires_at <= pg_catalog.now()
            ORDER BY dhaka_date ASC LOOP
    SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = d.dhaka_date FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'allocation row missing for %', d.dhaka_date USING ERRCODE = '23503'; END IF;

    -- Re-select under the allocation lock; locked rows are the only ones transitioned.
    WITH due AS (
      SELECT id FROM burger_boost.reward_reservations
       WHERE dhaka_date = d.dhaka_date AND status = 'reserved' AND expires_at <= pg_catalog.now()
       FOR UPDATE),
    ex AS (
      UPDATE burger_boost.reward_reservations r SET status = 'expired'
        FROM due WHERE r.id = due.id AND r.status = 'reserved'
      RETURNING r.tier)
    SELECT count(*) FILTER (WHERE tier = 'full'), count(*) FILTER (WHERE tier = 'partial')
      INTO v_full, v_part FROM ex;

    IF v_full + v_part = 0 THEN CONTINUE; END IF;
    IF a.full_reserved < v_full OR a.partial_reserved < v_part THEN
      RAISE EXCEPTION 'counter inconsistency on % during expiry (full % < %, partial % < %)',
        d.dhaka_date, a.full_reserved, v_full, a.partial_reserved, v_part USING ERRCODE = '23514';
    END IF;
    UPDATE burger_boost.daily_allocations
       SET full_reserved = full_reserved - v_full, partial_reserved = partial_reserved - v_part,
           updated_at = pg_catalog.now()
     WHERE dhaka_date = d.dhaka_date;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'allocation update affected % rows', v_n USING ERRCODE = '40001'; END IF;
    total := total + v_full + v_part;
  END LOOP;
  RETURN total;
END $fn$;

CREATE OR REPLACE FUNCTION burger_boost.get_owner_settings()
RETURNS pg_catalog.jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE cfg burger_boost.settings%ROWTYPE; a burger_boost.daily_allocations%ROWTYPE;
        d date := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002'; END IF;
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

-- Server must verify the caller's Owner permission (challenges:edit) from the JWT first.
CREATE OR REPLACE FUNCTION burger_boost.update_settings(
  p_owner_max int2, p_partial_max int2, p_full_limit int4,
  p_partial_limit int4, p_min_order int4, p_gate_count int2)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE v_n int4;
BEGIN
  IF p_owner_max NOT BETWEEN 0 AND 50 OR p_partial_max NOT BETWEEN 0 AND p_owner_max
     OR p_full_limit NOT BETWEEN 0 AND 1000 OR p_partial_limit NOT BETWEEN 0 AND 1000
     OR p_min_order NOT BETWEEN 0 AND 100000 OR p_gate_count NOT BETWEEN 10 AND 60 THEN
    RAISE EXCEPTION 'invalid settings' USING ERRCODE = '22023';
  END IF;
  UPDATE burger_boost.settings SET owner_max_discount = p_owner_max, partial_max_discount = p_partial_max,
    daily_full_limit = p_full_limit, daily_partial_limit = p_partial_limit, min_order_bdt = p_min_order,
    gate_count = p_gate_count, updated_at = pg_catalog.now() WHERE singleton_key = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002'; END IF;
  RETURN burger_boost.get_owner_settings();
END $fn$;

-- Claim. Lock: session -> allocation (today) -> reservation insert.
CREATE OR REPLACE FUNCTION burger_boost.claim_reward_reservation(p_session_id uuid, p_user_id uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE s burger_boost.sessions%ROWTYPE; cfg burger_boost.settings%ROWTYPE;
        a burger_boost.daily_allocations%ROWTYPE; ex burger_boost.reward_reservations%ROWTYPE;
        d date; m int4; v_full int4; v_part int4; v_tier text; v_pct int4;
BEGIN
  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002'; END IF;
  IF NOT cfg.game_enabled THEN RETURN pg_catalog.jsonb_build_object('result','game_disabled'); END IF;

  SELECT * INTO s FROM burger_boost.sessions WHERE id = p_session_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND OR s.mode <> 'reward' OR s.status <> 'completed' THEN
    RETURN pg_catalog.jsonb_build_object('result','not_eligible');
  END IF;

  SELECT * INTO ex FROM burger_boost.reward_reservations WHERE session_id = p_session_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('result','existing','id',ex.id,'tier',ex.tier,
      'discount_percent',ex.discount_percent,'status',ex.status,'expires_at',ex.expires_at);
  END IF;

  -- Meter range is [-100, 200]; <= 0 is a loss; above 100 earns the full tier cap.
  IF coalesce(s.final_meter, 0) <= 0 THEN RETURN pg_catalog.jsonb_build_object('result','loss'); END IF;
  m := LEAST(s.final_meter, 100);

  PERFORM burger_boost.expire_reward_reservations();

  d := (pg_catalog.now() AT TIME ZONE 'Asia/Dhaka')::date;
  INSERT INTO burger_boost.daily_allocations (dhaka_date) VALUES (d) ON CONFLICT (dhaka_date) DO NOTHING;
  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = d FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation row missing for %', d USING ERRCODE = '23503'; END IF;

  v_full := floor(cfg.owner_max_discount   * m / 100.0)::int4;
  v_part := floor(cfg.partial_max_discount * m / 100.0)::int4;

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
  VALUES (p_user_id, p_session_id, d, v_tier, v_pct,
          pg_catalog.now() + pg_catalog.make_interval(mins => cfg.claim_expiry_minutes))
  RETURNING * INTO ex;

  RETURN pg_catalog.jsonb_build_object('result','reserved','id',ex.id,'tier',ex.tier,
    'discount_percent',ex.discount_percent,'status',ex.status,'expires_at',ex.expires_at);
END $fn$;

CREATE OR REPLACE FUNCTION burger_boost.get_active_reward(p_user_id uuid)
RETURNS pg_catalog.jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
  SELECT pg_catalog.jsonb_build_object('id',r.id,'tier',r.tier,'discount_percent',r.discount_percent,
         'expires_at',r.expires_at,'min_order_bdt',(SELECT min_order_bdt FROM burger_boost.settings WHERE singleton_key))
    FROM burger_boost.reward_reservations r
   WHERE r.user_id = p_user_id AND r.status = 'reserved' AND r.expires_at > pg_catalog.now()
   ORDER BY r.created_at DESC LIMIT 1
$fn$;

-- Redeem. Lock: order -> allocation -> reservation (re-read FOR UPDATE).
CREATE OR REPLACE FUNCTION burger_boost.redeem_reward(p_id uuid, p_user_id uuid, p_order_id uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, public, pg_temp AS $fn$
DECLARE o record; v_date date; r burger_boost.reward_reservations%ROWTYPE;
        a burger_boost.daily_allocations%ROWTYPE; v_n int4;
BEGIN
  -- 1. Order: exists, belongs to the reservation user, not cancelled/progressed.
  SELECT id, user_id, status INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','order_not_found'); END IF;
  IF o.user_id IS DISTINCT FROM p_user_id THEN RETURN pg_catalog.jsonb_build_object('result','order_owner_mismatch'); END IF;
  IF o.status NOT IN ('placed','scheduled') THEN
    RETURN pg_catalog.jsonb_build_object('result','order_not_eligible','order_status',o.status);
  END IF;

  -- 2. Unlocked read only to learn the date, then lock allocation, then re-read reservation locked.
  SELECT dhaka_date INTO v_date FROM burger_boost.reward_reservations WHERE id = p_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','not_found'); END IF;

  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = v_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation row missing for %', v_date USING ERRCODE = '23503'; END IF;

  SELECT * INTO r FROM burger_boost.reward_reservations WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR r.user_id <> p_user_id OR r.dhaka_date <> v_date
     OR r.status <> 'reserved' OR r.expires_at <= pg_catalog.now() THEN
    RETURN pg_catalog.jsonb_build_object('result','unavailable');   -- no counter change
  END IF;

  -- 3. Counter sufficiency (only reached for a genuinely reserved row).
  IF (r.tier = 'full' AND a.full_reserved < 1) OR (r.tier = 'partial' AND a.partial_reserved < 1) THEN
    RAISE EXCEPTION 'counter inconsistency on % during redemption (tier %)', v_date, r.tier USING ERRCODE = '23514';
  END IF;

  UPDATE burger_boost.reward_reservations
     SET status = 'redeemed', redeemed_order_id = p_order_id, redeemed_at = pg_catalog.now()
   WHERE id = p_id AND status = 'reserved';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'reservation transition affected % rows', v_n USING ERRCODE = '40001'; END IF;

  UPDATE burger_boost.daily_allocations SET
    full_reserved      = full_reserved      - (r.tier = 'full')::int,
    full_slots_used    = full_slots_used    + (r.tier = 'full')::int,
    partial_reserved   = partial_reserved   - (r.tier = 'partial')::int,
    partial_slots_used = partial_slots_used + (r.tier = 'partial')::int,
    updated_at = pg_catalog.now()
   WHERE dhaka_date = v_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'allocation update affected % rows', v_n USING ERRCODE = '40001'; END IF;

  RETURN pg_catalog.jsonb_build_object('result','redeemed','discount_percent',r.discount_percent);
END $fn$;

-- Cancel + restore. The ONLY restoration path. Lock: order -> allocation -> reservation.
-- Server must authorise the actor (Owner order_management or the order's own customer) before calling.
CREATE OR REPLACE FUNCTION burger_boost.cancel_order_and_restore_reward(p_order_id uuid)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, public, pg_temp AS $fn$
DECLARE o record; v_res_id uuid; v_date date; r burger_boost.reward_reservations%ROWTYPE;
        a burger_boost.daily_allocations%ROWTYPE; v_n int4;
BEGIN
  SELECT id, status INTO o FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','order_not_found'); END IF;
  -- o.status is the persisted pre-cancellation status, read under the row lock.
  IF o.status = 'cancelled' THEN RETURN pg_catalog.jsonb_build_object('result','already_cancelled'); END IF;
  IF o.status NOT IN ('placed','confirmed') THEN
    RETURN pg_catalog.jsonb_build_object('result','not_cancellable','order_status',o.status);
  END IF;

  SELECT id, dhaka_date INTO v_res_id, v_date FROM burger_boost.reward_reservations WHERE redeemed_order_id = p_order_id;

  UPDATE public.orders SET status = 'cancelled' WHERE id = p_order_id AND status = o.status;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'order transition affected % rows', v_n USING ERRCODE = '40001'; END IF;

  IF v_res_id IS NULL THEN RETURN pg_catalog.jsonb_build_object('result','order_cancelled_no_reward'); END IF;

  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = v_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation row missing for %', v_date USING ERRCODE = '23503'; END IF;

  SELECT * INTO r FROM burger_boost.reward_reservations WHERE id = v_res_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'redeemed' OR r.redeemed_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'reservation % no longer linked to order %', v_res_id, p_order_id USING ERRCODE = '40001';
  END IF;

  -- Policy: one restoration per reservation lifetime; a second cancellation forfeits the reward.
  IF r.restored_count >= 1 THEN
    RETURN pg_catalog.jsonb_build_object('result','order_cancelled_reward_forfeited','reservation_id',r.id);
  END IF;

  IF (r.tier = 'full' AND a.full_slots_used < 1) OR (r.tier = 'partial' AND a.partial_slots_used < 1) THEN
    RAISE EXCEPTION 'counter inconsistency on % during restoration (tier %)', v_date, r.tier USING ERRCODE = '23514';
  END IF;

  UPDATE burger_boost.reward_reservations
     SET status = 'reserved', redeemed_order_id = NULL, redeemed_at = NULL,
         restored_count = restored_count + 1,
         expires_at = pg_catalog.now() + pg_catalog.make_interval(mins => 30)
   WHERE id = r.id AND status = 'redeemed' AND restored_count = 0
  RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation transition failed for %', v_res_id USING ERRCODE = '40001'; END IF;

  UPDATE burger_boost.daily_allocations SET
    full_reserved      = full_reserved      + (r.tier = 'full')::int,
    full_slots_used    = full_slots_used    - (r.tier = 'full')::int,
    partial_reserved   = partial_reserved   + (r.tier = 'partial')::int,
    partial_slots_used = partial_slots_used - (r.tier = 'partial')::int,
    updated_at = pg_catalog.now()
   WHERE dhaka_date = v_date;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'allocation update affected % rows', v_n USING ERRCODE = '40001'; END IF;

  RETURN pg_catalog.jsonb_build_object('result','order_cancelled_and_reward_restored',
    'reservation_id',r.id,'discount_percent',r.discount_percent,'expires_at',r.expires_at);
END $fn$;

-- Remove superseded objects from earlier drafts if they were ever created.
DROP FUNCTION IF EXISTS burger_boost.restore_reward(uuid);
DROP FUNCTION IF EXISTS burger_boost.cancel_order_and_restore_reward(uuid, uuid);

-- ----------------------------------------------------------------------------
-- 5. OWNERSHIP AND EXECUTE (service_role only). Nested calls
--    (claim -> expire, update_settings -> get_owner_settings) run as the
--    definer burger_boost_owner, which owns the callee, so EXECUTE is implicit.
-- ----------------------------------------------------------------------------
DO $g$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'burger_boost.expire_reward_reservations()',
    'burger_boost.get_owner_settings()',
    'burger_boost.update_settings(int2,int2,int4,int4,int4,int2)',
    'burger_boost.claim_reward_reservation(uuid,uuid)',
    'burger_boost.get_active_reward(uuid)',
    'burger_boost.redeem_reward(uuid,uuid,uuid)',
    'burger_boost.cancel_order_and_restore_reward(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO burger_boost_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP; END $g$;

COMMIT;
