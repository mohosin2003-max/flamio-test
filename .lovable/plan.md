# Burger Boost — Step 04: Database Integration Safety Plan (Read-only)

Nothing has been changed yet. These checks were read-only, on TEST `avwrptztixaketchgmsh` only. Production was not contacted.

## 1. Current Database Reality (checked this turn)
- `orders`, `order_items`, `coupons`, `challenges`, `challenge_attempts` all return **404**, so they do not exist in TEST.
- `burger_boost_settings/sessions/coupons` return **404** (they have not been created yet).
- `profiles` and `user_roles` return **401**, so they exist and are protected by RLS.
- Many files in `src/lib/*.functions.ts` (checkout, rewards, reports, challenges) call `orders`/`coupons`. In TEST, the code expects those tables but the database does not have them.
- Attendance tables were checked in the earlier audit (11 tables). Their internal table names were not checked again this turn.

## 2. Integration Blockers
1. TEST has no ordering schema, so real checkout cannot run end-to-end.
2. TEST has no `coupons` table, so the unified coupon resolver has nothing to fall back to for normal codes.
3. Challenge tables are missing, so Burger Boost cannot reuse the old challenge engine.
4. Migration drift from the earlier retention audit: GitHub must be the source of truth before any new migration.

## 3. Options Comparison
| | A. Game-only objects | B. Full ordering schema in TEST | C. Isolated test checkout adapter |
|---|---|---|---|
| Benefit | Smallest change, fully isolated | Most realistic checkout test | Real coupon transaction can be tested now |
| Risk | Redemption not testable | Large schema; may differ from Production, so drift | Adapter must be swapped out later |
| Production impact | Low | High (two diverging schemas) | Low (same RPC contract) |
| Attendance isolation | Full | Shares DB with a large new surface | Full |

**Recommended: A + C.** Build game-only `burger_boost_*` objects now. Redemption goes through one RPC, `burger_boost_redeem_coupon(order_ref, code)`, called by a small test adapter table `burger_boost_test_orders`. Later, the Production checkout calls the same RPC inside its order transaction. Only the caller changes; the coupon logic stays the same.

## 4. Coupon Transaction Design
- There is a single SECURITY DEFINER RPC `place_order_with_boost(items, code)` (in TEST, it writes the adapter order). One transaction does all of this:
  1. `SELECT ... FOR UPDATE` on the coupon row where `code`, `user_id = auth.uid()`, `status='active'` and `expires_at > now()`.
  2. Reject the order if the cart also has any other coupon (no stacking).
  3. Create the order and its items. Discount = subtotal × coupon pct, rounded to 2 decimals. There is no minimum order.
  4. `UPDATE coupon SET status='redeemed', order_ref, redeemed_at`.
- **Concurrent checkout:** the row lock means the second checkout sees `redeemed` and fails. A unique `(coupon_id)` on redemption gives extra protection.
- **Network failure:** the client sends an idempotency key. If the same key arrives again, the RPC returns the existing order and does not apply the coupon twice.
- **Rollback:** any error aborts the whole transaction, and the coupon stays active.
- **Cancellation:** keep the current rule, which is that a redeemed coupon is not restored. *This needs Owner confirmation; it is not assumed.*
- **Storage:** coupons are kept on the customer's account (`user_id`, RLS: the owner of the coupon can read it). They expire 7 days after they are issued, and each can be used once.

## 5. Business Rules Kept Unchanged
- Option A: the reward is the final discount actually achieved.
- The target is only a target.
- The Owner max discount cap is enforced on the server.
- The discount starts at 0%.
- Burger size and discount are kept as separate state.
- The discount is stored as `numeric(5,2)`.

## 6. Attendance Isolation
- Only the `burger_boost_*` namespace is used.
- No foreign keys to attendance tables, and no attendance RPCs or cron jobs are changed.
- Every migration only adds things (`CREATE ... IF NOT EXISTS`).

## 7. Roadmap (each step needs approval)
1. Fix migration drift first: commit the existing retention DDL.
2. Migration: `burger_boost_settings`, `burger_boost_sessions`, `burger_boost_coupons`, `burger_boost_test_orders`, plus grants and RLS.
3. RPCs: `start_session`, `submit_session` (server replay and pct), `issue_coupon`, `place_order_with_boost`. Each depends on the step before it.
4. Server functions (`createServerFn` + auth middleware) wrapping the RPCs.
5. Tests: discount formula and cap, 2-decimal rounding, expiry, single use, concurrent redeem, no stacking, idempotent retry, rollback.
6. Owner settings page, then the game UI.

## 8. Remaining Risks
- The Production ordering schema in TEST has not been checked, so the adapter contract has to match it later.
- The cancellation policy has not been decided.
- The cron schema could not be read with this access.
- Attendance table names were not checked again this turn.

## 9. Verdict
**READY FOR STEP 5 WITH CONDITIONS:** fix the migration drift first, and the Owner needs to confirm the cancellation policy.
