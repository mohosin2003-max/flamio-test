-- FLAMIO Burger Boost — Phase 2A (TEST ONLY): Owner reward configuration foundation.
-- NOT APPLIED automatically. Run in TEST SQL editor only after approval.
-- Stores Owner-editable future reward values in separate reward_* columns.
-- Does NOT touch Phase 1 columns (owner_max_discount, partial_max_discount, ...),
-- coupon lock (bb_coupons_phase1_locked), session lock (bb_sessions_discount_locked),
-- or checkout. Values here are inert until a separately approved release.
BEGIN;
SET LOCAL ROLE burger_boost_owner;

ALTER TABLE burger_boost.settings
  ADD COLUMN IF NOT EXISTS reward_default_discount_percent pg_catalog.int2 NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reward_max_discount_percent     pg_catalog.int2 NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS reward_coupon_validity_days     pg_catalog.int2 NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reward_min_order_bdt            pg_catalog.int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_coupon_stacking_enabled  pg_catalog.bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_system_enabled           pg_catalog.bool NOT NULL DEFAULT false;

ALTER TABLE burger_boost.settings DROP CONSTRAINT IF EXISTS bb_settings_reward_config;
ALTER TABLE burger_boost.settings ADD CONSTRAINT bb_settings_reward_config CHECK (
  reward_max_discount_percent BETWEEN 0 AND 30
  AND reward_default_discount_percent BETWEEN 0 AND reward_max_discount_percent
  AND reward_coupon_validity_days BETWEEN 1 AND 365
  AND reward_min_order_bdt BETWEEN 0 AND 100000
);

CREATE OR REPLACE FUNCTION burger_boost.get_reward_config()
RETURNS pg_catalog.jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'default_discount_percent', reward_default_discount_percent,
    'owner_max_discount_percent', reward_max_discount_percent,
    'coupon_validity_days', reward_coupon_validity_days,
    'minimum_order_amount', reward_min_order_bdt,
    'coupon_stacking_enabled', reward_coupon_stacking_enabled,
    'reward_system_enabled', reward_system_enabled)
  FROM burger_boost.settings WHERE singleton_key = true
$fn$;

-- Caller (server) must verify the Owner role first. Changes only reward_* columns.
CREATE OR REPLACE FUNCTION burger_boost.update_reward_config(
  p_default int2, p_max int2, p_validity_days int2, p_min_order int4,
  p_stacking bool, p_enabled bool)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE v_n int4;
BEGIN
  IF p_max IS NULL OR p_max NOT BETWEEN 0 AND 30
     OR p_default IS NULL OR p_default NOT BETWEEN 0 AND p_max
     OR p_validity_days IS NULL OR p_validity_days NOT BETWEEN 1 AND 365
     OR p_min_order IS NULL OR p_min_order NOT BETWEEN 0 AND 100000
     OR p_stacking IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid reward config' USING ERRCODE = '22023';
  END IF;
  UPDATE burger_boost.settings SET
    reward_default_discount_percent = p_default, reward_max_discount_percent = p_max,
    reward_coupon_validity_days = p_validity_days, reward_min_order_bdt = p_min_order,
    reward_coupon_stacking_enabled = p_stacking, reward_system_enabled = p_enabled,
    updated_at = pg_catalog.now()
  WHERE singleton_key = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002'; END IF;
  RETURN burger_boost.get_reward_config();
END $fn$;

REVOKE ALL ON FUNCTION burger_boost.get_reward_config() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION burger_boost.update_reward_config(int2,int2,int2,int4,bool,bool) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.get_reward_config() TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.update_reward_config(int2,int2,int2,int4,bool,bool) TO service_role;

RESET ROLE;
COMMIT;
