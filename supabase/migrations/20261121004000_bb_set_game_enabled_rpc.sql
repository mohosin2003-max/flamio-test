-- FLAMIO BURGER BOOST — Owner game on/off RPC (TEST ONLY: avwrptztixaketchgmsh)
-- NOT APPLIED. Apply only after explicit Owner approval, in the TEST SQL editor.
-- Changes ONLY burger_boost.settings.game_enabled and updated_at. Does not set
-- the game on, does not drop or alter any constraint, lock, grant or setting.
BEGIN;
SET LOCAL ROLE burger_boost_owner;

CREATE OR REPLACE FUNCTION burger_boost.set_game_enabled(p_enabled boolean)
RETURNS pg_catalog.jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp AS $fn$
DECLARE
  v_n int4;
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'p_enabled cannot be null' USING ERRCODE = '22023';
  END IF;
  UPDATE burger_boost.settings
     SET game_enabled = p_enabled,
         updated_at = pg_catalog.now()
   WHERE singleton_key = true;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'settings row missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN burger_boost.get_owner_settings();
END $fn$;

REVOKE ALL ON FUNCTION burger_boost.set_game_enabled(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION burger_boost.set_game_enabled(boolean) TO service_role;

COMMIT;
