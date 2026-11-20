# Burger Boost — Owner Game On/Off Control (TEST only)

Target: Lovable TEST project + TEST database `avwrptztixaketchgmsh`. Production, flamio.bd and Attendance are untouched.

## Current state (inspected)
- `src/lib/burger-boost-owner.functions.ts`: `getOwnerRewardSettings` / `updateOwnerRewardSettings` use `requireSupabaseAuth` → read `user_roles` via `context.supabase` → `assertRewardSettingsOwner` → only then lazy-load `supabaseAdmin` and call `burger_boost` RPCs. `buildOwnerOverview()` hardcodes `gameEnabled: false`.
- `src/lib/burger-boost-settings.ts`: `assertRewardSettingsOwner` accepts only role `"owner"`; `RewardSettingsTransport` allows only `get_owner_settings | update_settings`; `parseOwnerRewardSettings` does not read `game_enabled`.
- `src/routes/_authenticated/owner.burger-boost.tsx`: Switch is `disabled`, label "Locked off".
- `update_settings` RPC has no `game_enabled` parameter; no toggle RPC exists.
- Live constraint `bb_settings_game_locked CHECK (game_enabled = false)` still present; migration `20261121003100_drop_bb_settings_game_locked.sql` (commit e638001) exists but is NOT applied.

## Plan
1. **Database (TEST-only, separate approval).** One new migration file, scope:
   - `CREATE FUNCTION burger_boost.set_game_enabled(p_enabled boolean)` SECURITY DEFINER, `search_path` pinned, updates only `game_enabled` + `updated_at` on the singleton row, rejects NULL, returns `get_owner_settings()`.
   - `OWNER TO burger_boost_owner`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE ... TO service_role` only.
   - Executed inside `BEGIN; SET LOCAL ROLE burger_boost_owner; ... COMMIT;`.
   - Does not drop `bb_settings_game_locked` (that stays in the existing separate migration), does not set `game_enabled=true`, no other table/constraint/grant touched.
2. **Server.** In `burger-boost-owner.functions.ts` add `setBurgerBoostGameEnabled` (POST): zod `{ enabled: boolean }` strict → `requireSupabaseAuth` → `user_roles` read via `context.supabase` → `assertRewardSettingsOwner` → only then `supabaseAdmin.schema("burger_boost").rpc("set_game_enabled", { p_enabled })`. Errors fail closed; never accepts a role from the client.
3. **Shared helpers.** In `burger-boost-settings.ts`: widen the transport type with `set_game_enabled`; add `gameEnabled` to `OwnerRewardSettings` parsed strictly as boolean (default `false` on anything else).
4. **Owner screen.** In `owner.burger-boost.tsx`: Switch reflects live `gameEnabled` from `getOwnerRewardSettings`; enabled only when settings are available; calls the new server function with a confirm step; shows the DB error if the lock is still applied. Checkout/coupon/0% text unchanged. Staff never see an active switch (server still enforces).
5. **Tests** (new `src/lib/burger-boost-game-enabled.test.mjs`, transport faked, never sends `true` to a real DB):
   - owner role → RPC `set_game_enabled` called once with exact boolean;
   - staff / manager / customer / no roles / role-read error → "Forbidden"/error, transport never called;
   - unauthenticated → rejected by middleware (assert function wiring includes `requireSupabaseAuth`);
   - invalid input (`"true"`, null, extra keys) rejected;
   - lock preservation: `RELEASE_LOCKS` stays `{checkout:false, couponIssuance:false}`, awarded discount 0, gate count and other settings identical before/after; migration text contains no `bb_sessions_discount_locked` / `bb_coupons_phase1_locked` / `DROP CONSTRAINT` / `game_enabled = true`.
   - Update existing `burger-boost-owner.test.mjs` only if the overview shape changes.

## Not changed
Gameplay timing (60s/15s/75s), 30 gates, scoring, replay, coupons, rewards, checkout, Attendance, production.

## Uncertainty / blockers
- No migration runner here: the new SQL must be run by you in the TEST SQL editor (postgres has SET on `burger_boost_owner`, verified earlier).
- Turning the game ON will still fail with 23514 until the separate `drop_bb_settings_game_locked` migration is approved and applied; turning OFF works either way.
- Live owner/staff end-to-end check is blocked: no session can be minted for this external database, so verification is via unit tests plus anon/no-key RPC denial probes.
