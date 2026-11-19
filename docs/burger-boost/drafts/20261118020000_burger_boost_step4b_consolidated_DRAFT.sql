-- ============================================================================
-- FLAMIO BURGER BOOST — STEP 4B CONSOLIDATED SOURCE CONTRACT (INACTIVE DRAFT — UNEXECUTED)
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
-- Consolidates foundation v4 + atomic order draft; previous drafts remain unchanged.
-- This script assumes the earlier base Burger Boost schema is installed.
-- Public scalar RPC exposes owner maximum only, not quotas or financial controls.
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
-- Additional atomic order prerequisites (unexecuted).
DO $pf$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('orders','code','text'),('orders','user_id','uuid'),('orders','channel','text'),
      ('orders','status','text'),('orders','order_kind','text'),('orders','subtotal','numeric'),
      ('orders','discount','numeric'),('orders','delivery_charge','numeric'),('orders','total','numeric'),
      ('orders','coupon_code','text'),('orders','scheduled_for','timestamp with time zone'),
      ('order_items','product_id','uuid'),('order_items','unit_price','numeric'),
      ('order_items','quantity','integer'),('order_items','combo_key','text'),
      ('products','category_id','uuid'),('products','slug','text'),('categories','slug','text')
    ) AS t(tbl,col,typ) LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                   AND table_name=r.tbl AND column_name=r.col AND data_type=r.typ) THEN
      RAISE EXCEPTION 'ATOMIC preflight: public.%.% (%) missing', r.tbl, r.col, r.typ;
    END IF;
  END LOOP;
  -- Release locks must still be present (this draft never opens them).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bb_sessions_discount_locked') THEN
    RAISE EXCEPTION 'ATOMIC preflight: release lock bb_sessions_discount_locked missing';
  END IF;
END $pf$;


-- PART B. MINIMUM CROSS-SCHEMA PRIVILEGES
--   burger_boost_owner needs on public.orders: SELECT (id,user_id,status,channel),
--   UPDATE (status), and row visibility through a policy scoped ONLY to itself.
--   Customer policies are unchanged. No BYPASSRLS.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO burger_boost_owner;
GRANT SELECT, INSERT ON public.orders, public.order_items TO burger_boost_owner;
GRANT UPDATE (status, subtotal, discount, total) ON public.orders TO burger_boost_owner;
GRANT SELECT ON public.products, public.categories TO burger_boost_owner;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uq
  ON public.orders (idempotency_key) WHERE idempotency_key IS NOT NULL;


DROP POLICY IF EXISTS bb_owner_orders_select ON public.orders;
CREATE POLICY bb_owner_orders_select ON public.orders FOR SELECT TO burger_boost_owner USING (true);
DROP POLICY IF EXISTS bb_owner_orders_update ON public.orders;
CREATE POLICY bb_owner_orders_update ON public.orders FOR UPDATE TO burger_boost_owner USING (true) WITH CHECK (true);

GRANT USAGE ON SCHEMA burger_boost TO service_role;

DROP POLICY IF EXISTS bb_owner_orders_insert ON public.orders;
CREATE POLICY bb_owner_orders_insert ON public.orders FOR INSERT TO burger_boost_owner WITH CHECK (true);
DROP POLICY IF EXISTS bb_owner_items_select ON public.order_items;
CREATE POLICY bb_owner_items_select ON public.order_items FOR SELECT TO burger_boost_owner USING (true);
DROP POLICY IF EXISTS bb_owner_items_insert ON public.order_items;
CREATE POLICY bb_owner_items_insert ON public.order_items FOR INSERT TO burger_boost_owner WITH CHECK (true);
-- products/categories already have SELECT USING (true) for anon/authenticated only:
DROP POLICY IF EXISTS bb_owner_products_select ON public.products;
CREATE POLICY bb_owner_products_select ON public.products FOR SELECT TO burger_boost_owner USING (true);
DROP POLICY IF EXISTS bb_owner_categories_select ON public.categories;
CREATE POLICY bb_owner_categories_select ON public.categories FOR SELECT TO burger_boost_owner USING (true);


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

-- No standalone redemption path: redemption belongs to place_order_with_reward.
DROP FUNCTION IF EXISTS burger_boost.redeem_reward(uuid,uuid,uuid);

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
CREATE OR REPLACE FUNCTION burger_boost.place_order_with_reward(
  p_user_id uuid, p_reservation_id uuid, p_idempotency_key text, p_order jsonb, p_items jsonb)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, public, pg_temp AS $fn$
DECLARE
  v_existing record; v_date date; v_min int4;
  a burger_boost.daily_allocations%ROWTYPE; r burger_boost.reward_reservations%ROWTYPE;
  v_order_id uuid; v_subtotal numeric; v_eligible numeric; v_discount numeric;
  v_delivery numeric; v_total numeric; v_n int4;
BEGIN
  -- Database-side TEST hold: future release needs separate explicit approval.
  RETURN pg_catalog.jsonb_build_object('result','release_locked');
  IF p_user_id IS NULL OR p_reservation_id IS NULL
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023';
  END IF;
  IF (p_order->>'channel') IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'reward orders are online only' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_order->>'coupon_code','') IS NOT NULL THEN
    RAISE EXCEPTION 'coupon and reward cannot be combined' USING ERRCODE = '22023';
  END IF;

  -- 0. Idempotent replay: same key already committed -> return that order.
  SELECT id, code, user_id, discount, total INTO v_existing
    FROM public.orders WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id OR NOT EXISTS (
        SELECT 1 FROM burger_boost.reward_reservations
         WHERE id = p_reservation_id AND redeemed_order_id = v_existing.id) THEN
      RETURN pg_catalog.jsonb_build_object('result','idempotency_conflict');
    END IF;
    RETURN pg_catalog.jsonb_build_object('result','replayed','order_id',v_existing.id,
      'order_code',v_existing.code,'discount',v_existing.discount,'total',v_existing.total);
  END IF;

  -- 2. Allocation lock (date learned by unlocked read, re-checked under lock).
  SELECT dhaka_date INTO v_date FROM burger_boost.reward_reservations
   WHERE id = p_reservation_id AND user_id = p_user_id;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('result','reservation_not_found'); END IF;
  SELECT * INTO a FROM burger_boost.daily_allocations WHERE dhaka_date = v_date FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation row missing for %', v_date USING ERRCODE = '23503'; END IF;

  -- Recheck the committed idempotency winner after waiting for allocation lock.
  SELECT id, code, user_id, discount, total INTO v_existing
    FROM public.orders WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM p_user_id OR NOT EXISTS (
        SELECT 1 FROM burger_boost.reward_reservations
         WHERE id = p_reservation_id AND redeemed_order_id = v_existing.id) THEN
      RETURN pg_catalog.jsonb_build_object('result','idempotency_conflict');
    END IF;
    RETURN pg_catalog.jsonb_build_object('result','replayed','order_id',v_existing.id,
      'order_code',v_existing.code,'discount',v_existing.discount,'total',v_existing.total);
  END IF;

  -- 3. Reservation lock + validation.
  SELECT * INTO r FROM burger_boost.reward_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF NOT FOUND OR r.user_id <> p_user_id OR r.dhaka_date <> v_date
     OR r.status <> 'reserved' OR r.expires_at <= pg_catalog.now()
     OR r.discount_percent NOT BETWEEN 1 AND 50 THEN
    RETURN pg_catalog.jsonb_build_object('result','reservation_unavailable');
  END IF;
  IF (r.tier = 'full' AND a.full_reserved < 1) OR (r.tier = 'partial' AND a.partial_reserved < 1) THEN
    RAISE EXCEPTION 'counter inconsistency on % (tier %)', v_date, r.tier USING ERRCODE = '23514';
  END IF;
  SELECT min_order_bdt INTO v_min FROM burger_boost.settings WHERE singleton_key = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002'; END IF;

  -- 4. Order row (money placeholders; recomputed from persisted items below).
  v_delivery := CASE WHEN p_order->>'fulfillment' = 'delivery'
                     THEN GREATEST((p_order->>'delivery_charge')::numeric, 0) ELSE 0 END;
  INSERT INTO public.orders (code, user_id, channel, status, order_kind, scheduled_for, scheduled_activate_at,
      fulfillment, payment_method, payment_label, customer_name, customer_phone,
      address_line, area, landmark, delivery_notes, zone_id, zone_name, latitude, longitude, distance_m,
      estimated_time, pickup_note, subtotal, discount, delivery_charge, total, coupon_code, idempotency_key)
  VALUES (p_order->>'code', p_user_id, 'online',
      CASE WHEN p_order->>'status' = 'scheduled' THEN 'scheduled' ELSE 'placed' END,
      CASE WHEN p_order->>'status' = 'scheduled' THEN 'scheduled' ELSE 'regular' END,
      (p_order->>'scheduled_for')::timestamptz, (p_order->>'scheduled_activate_at')::timestamptz,
      p_order->>'fulfillment', p_order->>'payment_method', p_order->>'payment_label',
      p_order->>'customer_name', p_order->>'customer_phone',
      p_order->>'address_line', p_order->>'area', p_order->>'landmark', p_order->>'delivery_notes',
      p_order->>'zone_id', p_order->>'zone_name', (p_order->>'latitude')::numeric,
      (p_order->>'longitude')::numeric, (p_order->>'distance_m')::numeric,
      p_order->>'estimated_time', p_order->>'pickup_note', 0, 0, v_delivery, 0, NULL, p_idempotency_key)
  RETURNING id INTO v_order_id;   -- duplicate code (23505) aborts; server retries with a new code

  -- 5. Items.
  INSERT INTO public.order_items (order_id, product_id, product_slug, product_name, variant_id, variant_name,
      unit_price, quantity, image_url, combo_name, combo_key)
  SELECT v_order_id, (i->>'product_id')::uuid, i->>'product_slug', i->>'product_name',
         (i->>'variant_id')::uuid, i->>'variant_name', (i->>'unit_price')::numeric,
         (i->>'quantity')::int, i->>'image_url', i->>'combo_name', i->>'combo_key'
    FROM pg_catalog.jsonb_array_elements(p_items) AS i;

  -- 6. Money from PERSISTED items + products/categories (slug from products, not payload).
  SELECT COALESCE(sum(oi.unit_price * oi.quantity), 0),
         COALESCE(sum(oi.unit_price * oi.quantity) FILTER (WHERE oi.combo_key IS NULL AND p.slug NOT IN ('nachos','bbq-wings-4-pcs','chicken-lollipop-6-pcs') AND (
             c.slug IN ('burger','meat-box','pizza','pasta')
          OR (c.slug = 'shawarma-and-sides' AND p.slug IN ('chicken-shawarma')))), 0)
    INTO v_subtotal, v_eligible
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    LEFT JOIN public.categories c ON c.id = p.category_id
   WHERE oi.order_id = v_order_id;
  -- Excluded: nachos, bbq-wings-4-pcs, chicken-lollipop-6-pcs, drinks, addons, combos, delivery.
  IF v_eligible <= 0 THEN RAISE EXCEPTION 'no_eligible_items' USING ERRCODE = 'P0B01'; END IF;
  IF v_eligible < COALESCE(v_min, 0) THEN RAISE EXCEPTION 'below_minimum' USING ERRCODE = 'P0B02'; END IF;
  v_discount := LEAST(v_eligible, pg_catalog.floor(v_eligible * r.discount_percent / 100));
  v_total := v_subtotal - v_discount + v_delivery;   -- delivery never discounted

  UPDATE public.orders SET subtotal = v_subtotal, discount = v_discount, total = v_total
   WHERE id = v_order_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'order money update affected % rows', v_n USING ERRCODE = '40001'; END IF;

  -- 7. Redeem (once) and move counter reserved -> used.
  UPDATE burger_boost.reward_reservations
     SET status = 'redeemed', redeemed_order_id = v_order_id, redeemed_at = pg_catalog.now()
   WHERE id = r.id AND status = 'reserved';
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

  RETURN pg_catalog.jsonb_build_object('result','placed','order_id',v_order_id,
    'order_code',p_order->>'code','eligible_subtotal',v_eligible,'discount',v_discount,
    'total',v_total,'reservation_id',r.id);
END $fn$;


-- Narrow PUBLIC read-only RPC. No direct table grants, no admin public reads.
CREATE OR REPLACE FUNCTION burger_boost.get_public_owner_max()
RETURNS pg_catalog.int2 LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
  SELECT owner_max_discount FROM burger_boost.settings WHERE singleton_key = true
$fn$;
ALTER FUNCTION burger_boost.get_public_owner_max() OWNER TO burger_boost_owner;
REVOKE ALL ON FUNCTION burger_boost.get_public_owner_max() FROM PUBLIC;
GRANT USAGE ON SCHEMA burger_boost TO anon, authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.get_public_owner_max() TO anon, authenticated, service_role;

DO $g$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb)',
    'burger_boost.expire_reward_reservations()',
    'burger_boost.get_owner_settings()',
    'burger_boost.update_settings(int2,int2,int4,int4,int4,int2)',
    'burger_boost.claim_reward_reservation(uuid,uuid)',
    'burger_boost.get_active_reward(uuid)',
    'burger_boost.cancel_order_and_restore_reward(uuid)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO burger_boost_owner', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP; END $g$;

COMMIT;
-- UNEXECUTED REVIEW BLOCKERS:
-- 1. Approve this inactive draft separately before any SQL execution.
-- 2. Confirm TEST schema/types, PostgREST exposed schema and trigger privileges.
-- 3. Test concurrent duplicate placement, redemption/expiry, cancellation/kitchen,
--    rollback and one-time restoration with two real PostgreSQL connections.
-- 4. Ordinary source inserts now require orders.idempotency_key: no silent fallback.
-- 5. Atomic placement remains explicitly release_locked even if installed.
-- 6. Persisted items come from the authenticated server's authoritative pricing;
--    direct browser RPC execution is revoked. Delivery charges are server validated.
-- 7. No Android acceptance is implied by this source/draft work.
