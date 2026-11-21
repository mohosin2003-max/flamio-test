-- FLAMIO Burger Boost — Phase 2B reward unlock
-- TEST ONLY. Enables reward issuance + reward-backed checkout.
-- Production remains untouched.

SET ROLE burger_boost_owner;

ALTER TABLE burger_boost.reward_reservations
  ADD COLUMN IF NOT EXISTS coupon_id uuid UNIQUE REFERENCES burger_boost.coupons(id);

ALTER TABLE burger_boost.coupons
  DROP CONSTRAINT IF EXISTS bb_coupons_phase1_locked;

ALTER TABLE burger_boost.sessions
  DROP CONSTRAINT IF EXISTS bb_sessions_discount_locked;

CREATE OR REPLACE FUNCTION burger_boost.complete_reward_session(
  p_id uuid,
  p_user_id uuid,
  p_final_meter integer,
  p_telemetry_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.now();
  s burger_boost.sessions%ROWTYPE;
  cfg burger_boost.settings%ROWTYPE;
  v_meter int;
  v_pct int;
BEGIN
  IF (select auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_id IS NULL OR p_user_id IS NULL OR p_final_meter IS NULL
     OR p_telemetry_hash IS NULL OR p_telemetry_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('result','invalid');
  END IF;

  PERFORM pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bb58:reward:' || p_user_id::text, 0)
  );

  SELECT * INTO s
  FROM burger_boost.sessions
  WHERE id = p_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND OR s.mode <> 'reward' OR s.status <> 'in_progress' THEN
    RETURN jsonb_build_object('result','not_eligible');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM burger_boost.daily_reward_attempts x
    WHERE x.session_id = s.id AND x.user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('result','integrity_violation');
  END IF;

  IF v_now > s.expires_at THEN
    UPDATE burger_boost.sessions
    SET status='expired', updated_at=v_now
    WHERE id=s.id AND status='in_progress';
    RETURN jsonb_build_object('result','expired');
  END IF;

  SELECT * INTO cfg
  FROM burger_boost.settings
  WHERE singleton_key=true;

  IF NOT FOUND OR NOT cfg.reward_system_enabled THEN
    RETURN jsonb_build_object(
      'result','reward_disabled',
      'awarded_discount_percent',0
    );
  END IF;

  v_meter := least(greatest(p_final_meter,0),100);
  v_pct := floor(
    cfg.reward_default_discount_percent * v_meter / 100.0
  )::int;
  v_pct := least(v_pct, cfg.reward_max_discount_percent);

  UPDATE burger_boost.sessions
  SET status='completed',
      verified_score=greatest(p_final_meter,0),
      final_meter=p_final_meter,
      telemetry_hash=p_telemetry_hash,
      completed_at=v_now,
      allocated_tier=CASE WHEN v_pct > 0 THEN 'full' ELSE NULL END,
      awarded_discount_percent=v_pct,
      updated_at=v_now
  WHERE id=s.id AND status='in_progress';

  RETURN jsonb_build_object(
    'result', CASE WHEN v_pct > 0 THEN 'reward_ready' ELSE 'no_reward' END,
    'final_meter',p_final_meter,
    'awarded_discount_percent',v_pct
  );
END
$function$;

CREATE OR REPLACE FUNCTION burger_boost.claim_reward_reservation(
  p_session_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  s burger_boost.sessions%ROWTYPE;
  cfg burger_boost.settings%ROWTYPE;
  r burger_boost.reward_reservations%ROWTYPE;
  c burger_boost.coupons%ROWTYPE;
  v_code text;
BEGIN
  IF (select auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO s
  FROM burger_boost.sessions
  WHERE id=p_session_id AND user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND OR s.mode <> 'reward' OR s.status <> 'completed' THEN
    RETURN jsonb_build_object('result','not_eligible');
  END IF;

  IF coalesce(s.awarded_discount_percent,0) <= 0 THEN
    RETURN jsonb_build_object('result','no_reward');
  END IF;

  SELECT * INTO r
  FROM burger_boost.reward_reservations
  WHERE session_id=p_session_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO c FROM burger_boost.coupons WHERE id=r.coupon_id;
    RETURN jsonb_build_object(
      'result','existing',
      'id',r.id,
      'coupon_id',r.coupon_id,
      'coupon_code',c.code,
      'tier',r.tier,
      'discount_percent',r.discount_percent,
      'status',r.status,
      'expires_at',r.expires_at
    );
  END IF;

  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key=true;
  IF NOT FOUND OR NOT cfg.reward_system_enabled THEN
    RETURN jsonb_build_object('result','reward_disabled');
  END IF;

  v_code := 'BB-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  INSERT INTO burger_boost.coupons(
    user_id, code, discount_percent, status, issued_at, expires_at
  )
  VALUES(
    p_user_id,
    v_code,
    least(s.awarded_discount_percent::numeric,cfg.reward_max_discount_percent::numeric),
    'active',
    pg_catalog.now(),
    pg_catalog.now() + make_interval(days=>cfg.reward_coupon_validity_days)
  )
  RETURNING * INTO c;

  INSERT INTO burger_boost.reward_reservations(
    user_id,session_id,dhaka_date,tier,discount_percent,status,expires_at,coupon_id
  )
  VALUES(
    p_user_id,
    p_session_id,
    (s.started_at AT TIME ZONE 'Asia/Dhaka')::date,
    'full',
    s.awarded_discount_percent::smallint,
    'reserved',
    pg_catalog.now() + make_interval(mins=>cfg.claim_expiry_minutes),
    c.id
  )
  RETURNING * INTO r;

  RETURN jsonb_build_object(
    'result','reserved',
    'id',r.id,
    'coupon_id',c.id,
    'coupon_code',c.code,
    'tier',r.tier,
    'discount_percent',r.discount_percent,
    'status',r.status,
    'expires_at',r.expires_at,
    'coupon_expires_at',c.expires_at
  );
END
$function$;

CREATE OR REPLACE FUNCTION burger_boost.place_order_with_reward(
  p_user_id uuid,
  p_reservation_id uuid,
  p_idempotency_key text,
  p_order jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  r burger_boost.reward_reservations%ROWTYPE;
  c burger_boost.coupons%ROWTYPE;
  cfg burger_boost.settings%ROWTYPE;
  v_order_id uuid;
  v_code text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_delivery numeric := 0;
  v_total numeric := 0;
  v_item_count int := 0;
  v_existing uuid;
BEGIN
  IF (select auth.uid()) IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;

  SELECT id INTO v_existing
  FROM public.orders
  WHERE idempotency_key=p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object('result','existing_order','order_id',v_existing);
  END IF;

  SELECT * INTO cfg FROM burger_boost.settings WHERE singleton_key=true;
  IF NOT FOUND OR NOT cfg.reward_system_enabled THEN
    RETURN jsonb_build_object('result','reward_disabled');
  END IF;

  SELECT * INTO r
  FROM burger_boost.reward_reservations
  WHERE id=p_reservation_id AND user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND OR r.status <> 'reserved' THEN
    RETURN jsonb_build_object('result','reservation_invalid');
  END IF;

  IF pg_catalog.now() >= r.expires_at THEN
    UPDATE burger_boost.reward_reservations
    SET status='expired'
    WHERE id=r.id AND status='reserved';

    IF r.coupon_id IS NOT NULL THEN
      UPDATE burger_boost.coupons
      SET status='expired'
      WHERE id=r.coupon_id AND status='active';
    END IF;

    RETURN jsonb_build_object('result','reservation_expired');
  END IF;

  IF r.coupon_id IS NULL THEN
    RAISE EXCEPTION 'coupon missing';
  END IF;

  SELECT * INTO c
  FROM burger_boost.coupons
  WHERE id=r.coupon_id AND user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND OR c.status <> 'active' OR pg_catalog.now() >= c.expires_at THEN
    RETURN jsonb_build_object('result','coupon_invalid');
  END IF;

  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items)=0 THEN
    RAISE EXCEPTION 'items required';
  END IF;

  IF coalesce(p_order->>'customer_name','') = ''
     OR coalesce(p_order->>'customer_phone','') = ''
     OR coalesce(p_order->>'fulfillment','') = ''
     OR coalesce(p_order->>'payment_method','') = ''
     OR coalesce(p_order->>'payment_label','') = '' THEN
    RAISE EXCEPTION 'required order fields missing';
  END IF;

  WITH input_items AS (
    SELECT
      (x->>'product_id')::uuid AS product_id,
      nullif(x->>'variant_id','')::uuid AS variant_id,
      (x->>'quantity')::int AS quantity,
      x->>'combo_name' AS combo_name,
      x->>'combo_key' AS combo_key
    FROM jsonb_array_elements(p_items) x
  ),
  priced AS (
    SELECT
      i.*,
      p.slug AS product_slug,
      p.name AS product_name,
      p.is_available AS product_available,
      pv.name AS variant_name,
      pv.price AS variant_price,
      pv.is_available AS variant_available,
      p.base_price
    FROM input_items i
    JOIN public.products p ON p.id=i.product_id
    LEFT JOIN public.product_variants pv
      ON pv.id=i.variant_id AND pv.product_id=i.product_id
  )
  SELECT
    count(*),
    coalesce(sum(
      CASE WHEN variant_id IS NULL THEN base_price ELSE variant_price END
      * quantity
    ),0)
  INTO v_item_count, v_subtotal
  FROM priced
  WHERE quantity > 0
    AND product_available=true
    AND (variant_id IS NULL OR (variant_price IS NOT NULL AND variant_available=true));

  IF v_item_count <> jsonb_array_length(p_items) THEN
    RAISE EXCEPTION 'invalid or unavailable order item';
  END IF;

  v_delivery := greatest(coalesce((p_order->>'delivery_charge')::numeric,0),0);
  IF coalesce((p_order->>'fulfillment'),'') = 'pickup' THEN
    v_delivery := 0;
  END IF;

  IF v_subtotal < cfg.min_order_bdt THEN
    RETURN jsonb_build_object('result','below_minimum','minimum_order_bdt',cfg.min_order_bdt);
  END IF;

  IF cfg.reward_coupon_stacking_enabled=false
     AND coalesce(p_order->>'coupon_code','') <> ''
     AND upper(p_order->>'coupon_code') <> upper(c.code) THEN
    RETURN jsonb_build_object('result','coupon_stacking_blocked');
  END IF;

  v_discount := round(v_subtotal * least(r.discount_percent::numeric,cfg.reward_max_discount_percent::numeric) / 100.0,2);
  v_total := greatest(v_subtotal - v_discount + v_delivery,0);

  v_code := 'FLM-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));

  INSERT INTO public.orders(
    code,user_id,customer_name,customer_phone,fulfillment,status,
    address_line,area,landmark,delivery_notes,pickup_note,
    zone_id,zone_name,estimated_time,payment_method,payment_label,
    coupon_code,subtotal,discount,delivery_charge,total,
    channel,order_kind,payment_status,idempotency_key
  )
  VALUES(
    v_code,p_user_id,
    p_order->>'customer_name',
    p_order->>'customer_phone',
    p_order->>'fulfillment',
    coalesce(nullif(p_order->>'status',''),'pending'),
    p_order->>'address_line',
    p_order->>'area',
    p_order->>'landmark',
    p_order->>'delivery_notes',
    p_order->>'pickup_note',
    p_order->>'zone_id',
    p_order->>'zone_name',
    p_order->>'estimated_time',
    p_order->>'payment_method',
    p_order->>'payment_label',
    c.code,
    v_subtotal,
    v_discount,
    v_delivery,
    v_total,
    coalesce(nullif(p_order->>'channel',''),'online'),
    coalesce(nullif(p_order->>'order_kind',''),'regular'),
    coalesce(nullif(p_order->>'payment_status',''),'unpaid'),
    p_idempotency_key
  )
  RETURNING id INTO v_order_id;

  WITH input_items AS (
    SELECT
      (x->>'product_id')::uuid AS product_id,
      nullif(x->>'variant_id','')::uuid AS variant_id,
      (x->>'quantity')::int AS quantity,
      x->>'combo_name' AS combo_name,
      x->>'combo_key' AS combo_key
    FROM jsonb_array_elements(p_items) x
  ),
  priced AS (
    SELECT
      i.*,
      p.slug AS product_slug,
      p.name AS product_name,
      pv.name AS variant_name,
      pv.price AS variant_price,
      p.base_price
    FROM input_items i
    JOIN public.products p ON p.id=i.product_id
    LEFT JOIN public.product_variants pv
      ON pv.id=i.variant_id AND pv.product_id=i.product_id
  )
  INSERT INTO public.order_items(
    order_id,product_id,product_slug,product_name,variant_id,variant_name,
    quantity,unit_price,combo_name,combo_key
  )
  SELECT
    v_order_id,
    product_id,product_slug,product_name,variant_id,variant_name,
    quantity,
    CASE WHEN variant_id IS NULL THEN base_price ELSE variant_price END,
    combo_name,combo_key
  FROM priced;

  UPDATE burger_boost.reward_reservations
  SET status='redeemed',
      redeemed_order_id=v_order_id,
      redeemed_at=pg_catalog.now()
  WHERE id=r.id AND status='reserved';

  UPDATE burger_boost.coupons
  SET status='redeemed',
      redeemed_at=pg_catalog.now(),
      redeemed_order_id=v_order_id
  WHERE id=c.id AND status='active';

  RETURN jsonb_build_object(
    'result','order_created',
    'order_id',v_order_id,
    'order_code',v_code,
    'subtotal',v_subtotal,
    'discount',v_discount,
    'delivery_charge',v_delivery,
    'total',v_total,
    'discount_percent',r.discount_percent,
    'coupon_code',c.code
  );
END
$function$;

REVOKE ALL ON FUNCTION burger_boost.complete_reward_session(uuid,uuid,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION burger_boost.claim_reward_reservation(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION burger_boost.complete_reward_session(uuid,uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.claim_reward_reservation(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.place_order_with_reward(uuid,uuid,text,jsonb,jsonb) TO authenticated;

UPDATE burger_boost.settings
SET reward_system_enabled=true,
    reward_default_discount_percent=10,
    reward_max_discount_percent=30,
    reward_coupon_validity_days=7,
    reward_coupon_stacking_enabled=false,
    min_order_bdt=0,
    updated_at=pg_catalog.now()
WHERE singleton_key=true;

RESET ROLE;