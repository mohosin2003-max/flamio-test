-- ============================================================================
-- FLAMIO BURGER BOOST — STEP 4B ATOMIC ORDER + REWARD (DRAFT — NOT APPLIED)
-- Target: TEST Supabase ONLY (avwrptztixaketchgmsh). NEVER production.
-- Depends on: 20261118000000_burger_boost_step4b_final_reward_DRAFT.sql (v4).
-- NOT EXECUTED. Requires explicit approval. Release locks are NOT touched.
--
-- One function, one transaction: order + items + discount + redemption +
-- counter move. Any RAISE rolls back everything (no compensating DELETE).
--
-- Lock order (consistent with v4 global order; a NEW order has no row to
-- lock first, so level 1 is skipped):
--   2. burger_boost.daily_allocations row (FOR UPDATE)
--   3. burger_boost.reward_reservations row (FOR UPDATE)
--   then INSERT public.orders, public.order_items (new rows, no contention).
-- cancel_order_and_restore_reward locks order -> allocation -> reservation;
-- a new order is invisible to it until COMMIT, so no inversion is possible.
-- ============================================================================
BEGIN;

-- PART A. PREFLIGHT ----------------------------------------------------------
DO $pf$ DECLARE r record; BEGIN
  IF to_regprocedure('burger_boost.cancel_order_and_restore_reward(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ATOMIC preflight: v4 draft not applied';
  END IF;
  IF to_regclass('burger_boost.reward_reservations') IS NULL THEN
    RAISE EXCEPTION 'ATOMIC preflight: reward_reservations missing';
  END IF;
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

-- PART B. IDEMPOTENCY PREREQUISITE (schema addition; public.orders has none) --
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uq
  ON public.orders (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- PART C. MINIMUM PRIVILEGES FOR THE DEFINER -------------------------------
GRANT SELECT, INSERT ON public.orders, public.order_items TO burger_boost_owner;
GRANT SELECT ON public.products, public.categories TO burger_boost_owner;
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

-- PART D. FUNCTION ------------------------------------------------------------
-- p_user_id comes ONLY from the server's verified session (service_role caller).
-- p_order carries server-validated header fields; money fields are ignored.
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
  IF p_user_id IS NULL OR p_reservation_id IS NULL
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'invalid arguments' USING ERRCODE = '22023';
  END IF;
  IF (p_order->>'channel') IS DISTINCT FROM 'online' THEN
    RAISE EXCEPTION 'reward orders are online only' USING ERRCODE = '22023';
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
         COALESCE(sum(oi.unit_price * oi.quantity) FILTER (WHERE oi.combo_key IS NULL AND (
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

-- The standalone redeem path is superseded: redemption only happens inside the order transaction.
REVOKE ALL ON FUNCTION burger_boost.redeem_reward(uuid,uuid,uuid) FROM service_role;

ALTER FUNCTION burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb) OWNER TO burger_boost_owner;
REVOKE ALL ON FUNCTION burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb) TO service_role;

COMMIT;
-- PENDING (needs approved TEST DB, two connections): concurrent redemption of
-- one reservation, redemption vs expiry, cancel vs kitchen, rollback on
-- below_minimum leaving counters unchanged, AFTER INSERT triggers on orders
-- running under burger_boost_owner privileges.
