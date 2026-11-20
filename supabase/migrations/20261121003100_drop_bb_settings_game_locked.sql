-- FLAMIO BURGER BOOST — remove Phase-1 game lock (TEST ONLY)
-- Target: TEST Supabase project avwrptztixaketchgmsh ONLY.
-- NOT APPLIED. Created for review; apply only after explicit Owner approval.
-- Scope: drops ONLY bb_settings_game_locked. Does NOT set game_enabled=true.
-- Unchanged: bb_sessions_discount_locked, bb_coupons_phase1_locked,
-- RELEASE_LOCKS (checkout=false, couponIssuance=false), all settings values.
-- Note: burger_boost.settings is owned by burger_boost_owner; the executing
-- role must be (or SET ROLE to) the table owner, otherwise 42501.

ALTER TABLE burger_boost.settings
  DROP CONSTRAINT IF EXISTS bb_settings_game_locked;
