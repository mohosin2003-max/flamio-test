-- FLAMIO Burger Boost — Phase 2A Reward Settings
-- TEST only. Not applied by this commit.
SET ROLE burger_boost_owner;

ALTER TABLE burger_boost.settings
  ADD COLUMN IF NOT EXISTS reward_default_discount_percent int2 NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reward_max_discount_percent int2 NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS reward_coupon_validity_days int2 NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reward_coupon_stacking_enabled bool NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_system_enabled bool NOT NULL DEFAULT false;

ALTER TABLE burger_boost.settings
  DROP COLUMN IF EXISTS reward_min_order_bdt;

ALTER TABLE burger_boost.settings
  DROP CONSTRAINT IF EXISTS bb_settings_reward_config;

ALTER TABLE burger_boost.settings
  ADD CONSTRAINT bb_settings_reward_config CHECK (
    reward_max_discount_percent BETWEEN 0 AND 30
    AND reward_default_discount_percent BETWEEN 0 AND reward_max_discount_percent
    AND reward_coupon_validity_days BETWEEN 1 AND 365
    AND min_order_bdt BETWEEN 0 AND 100000
  );

CREATE OR REPLACE FUNCTION burger_boost.get_reward_config()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = burger_boost, public
AS $$
  SELECT jsonb_build_object(
    'defaultDiscountPercent', s.reward_default_discount_percent,
    'ownerMaxDiscountPercent', s.reward_max_discount_percent,
    'couponValidityDays', s.reward_coupon_validity_days,
    'minimumOrderAmount', s.min_order_bdt,
    'couponStackingEnabled', s.reward_coupon_stacking_enabled,
    'rewardSystemEnabled', s.reward_system_enabled
  )
  FROM burger_boost.settings s
  WHERE s.singleton_key = true;
$$;

CREATE OR REPLACE FUNCTION burger_boost.update_reward_config(
  p_default_discount_percent int2,
  p_max_discount_percent int2,
  p_coupon_validity_days int2,
  p_min_order_bdt int4,
  p_coupon_stacking_enabled bool,
  p_reward_system_enabled bool
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = burger_boost, public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_default_discount_percent < 0
     OR p_max_discount_percent < 0
     OR p_max_discount_percent > 30
     OR p_default_discount_percent > p_max_discount_percent
     OR p_coupon_validity_days < 1
     OR p_coupon_validity_days > 365
     OR p_min_order_bdt < 0
     OR p_min_order_bdt > 100000
  THEN
    RAISE EXCEPTION 'Invalid reward configuration';
  END IF;

  UPDATE burger_boost.settings
  SET reward_default_discount_percent = p_default_discount_percent,
      reward_max_discount_percent = p_max_discount_percent,
      reward_coupon_validity_days = p_coupon_validity_days,
      min_order_bdt = p_min_order_bdt,
      reward_coupon_stacking_enabled = p_coupon_stacking_enabled,
      reward_system_enabled = p_reward_system_enabled
  WHERE singleton_key = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Burger Boost settings row not found';
  END IF;

  SELECT burger_boost.get_reward_config() INTO v;
  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION burger_boost.get_reward_config() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION burger_boost.update_reward_config(int2,int2,int2,int4,bool,bool) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION burger_boost.get_reward_config() TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.update_reward_config(int2,int2,int2,int4,bool,bool) TO service_role;

RESET ROLE;
