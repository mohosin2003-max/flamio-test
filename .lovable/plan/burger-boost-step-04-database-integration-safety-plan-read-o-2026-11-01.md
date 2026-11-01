# Burger Boost — STEP 04: Database Integration Safety Plan (Read-only report)

Scope: TEST `avwrptztixaketchgmsh` only. Evidence came from read-only probes and code reads. Nothing was written, executed or deployed, and Production was not contacted.

## 1. Current Database Reality
Live TEST probes (REST, publishable key):
- `orders`, `order_items`, `coupons`, `challenges`, `challenge_attempts`: **404**, so they are missing.
- `burger_boost_settings`, `burger_boost_sessions`, `burger_boost_coupons`: **404**, so they have not been created yet.
- `profiles`, `user_roles`: **401**, so they exist and are protected by RLS.

Repository:
- There are 51 migrations. Some of them define ordering, coupon and challenge tables, but TEST does not have those tables. That means TEST was built from attendance migrations only.
- Checkout lives in `src/lib/orders.functions.ts` (`placeOrder`), and coupons in `src/lib/coupons.functions.ts`. Rewards, reports and challenges call `orders`/`coupons`.
- What checkout does today:
  1. Inserts the order.
  2. Inserts the items as a **separate call**. If that fails, it tries to delete the order.
  3. Then reads `coupons.times_used` and writes `+1` in a **separate read-then-write**.
- Checkout today is **not one transaction**, and the coupon count can race.

## 2. Integration Blockers
1. TEST has no ordering, coupon or challenge tables, so the real checkout cannot run.
2. Today's checkout runs as several separate steps. It cannot guarantee single-use coupon redemption under concurrency.
3. The coupon model is generic promo codes. It has no customer binding, no 7-day expiry and no single-use status.
4. The repo's migrations and the TEST schema disagree. Applying the repo migrations to TEST is unsafe without reviewing them first.

## 3. Architecture Options Comparison
| | A. Game-only objects | B. Full ordering schema in TEST | C. Isolated test checkout adapter |
|---|---|---|---|
| Benefit | Minimal, isolated, fast | Most realistic end-to-end | Real atomic redemption testable now |
| Risk | Redemption path untested | Large schema import, unreviewed migrations, more ways for TEST to drift | Adapter must be swapped later |
| Future Production impact | Low | High (risk of diverging schemas) | Low, because the RPC contract is reused |
| Attendance isolation | Full | Many new objects in the same DB | Full |

## 4. Recommended Safe Architecture: A + C
- Build the game on game-only `burger_boost_*` objects.
- All coupon redemption goes through **one database function** that does the locking, validation and redemption.
- In TEST, a minimal adapter order table `burger_boost_test_orders` (and its items) calls this function in the same transaction.
- In Production later, `placeOrder` is replaced by a single transactional RPC that calls the same redemption logic. Only the caller changes.
- Why: it is safe to test now, it keeps attendance untouched, and it does not import an unreviewed ordering schema into TEST.

## 5. Coupon Transaction Design
One SECURITY DEFINER RPC (`place_order_with_boost`) runs one transaction:
1. Validate the cart and price it on the server. There is no minimum order.
2. If a code is given:
   - Lock the coupon row with `SELECT ... FOR UPDATE` where `user_id = auth.uid()`, `status = 'active'` and `expires_at > now()`.
   - If anything fails, reject.
3. **Stacking:** only one coupon field is accepted. A BOOST code and a generic code together are rejected.
4. Discount = `round(subtotal × pct / 100, 2)`, where pct is stored as `numeric(5,2)`, already capped when it was issued.
5. Insert the order and its items.
6. Mark the coupon `redeemed` and record `order_id` and `redeemed_at`.
7. Commit.

Failure handling:
- **Concurrent checkout:** the second transaction waits on the lock, then sees `redeemed` and fails. A unique constraint on `redeemed_order_id` adds extra protection.
- **Network failure or retry:** a client idempotency key is stored on the order with a unique constraint. A retry returns the existing order and never redeems twice.
- **Rollback:** any error aborts everything, so the coupon stays `active` and no partial order is left.
- **Cancellation:** not decided (see Risks). No restore rule is assumed.
- **Storage and expiry:** coupons are kept on the customer's account (RLS: `user_id = auth.uid()` can read). `expires_at = issued_at + 7 days`, and each coupon can be used once.

## 6. Approved Business Rules (unchanged)
- Option A: the final discount actually achieved is the reward.
- The target is only a target.
- The Owner max discount cap is enforced on the server.
- The discount starts at 0%.
- Burger size and discount are separate state.
- The discount has at most 2 decimals.

## 7. Attendance Isolation Guarantee
- New objects use only the `burger_boost_*` prefix.
- No foreign keys, triggers or RPC calls into attendance tables.
- No changes to attendance functions, cron, Edge Functions or storage.
- Migrations only add things (`IF NOT EXISTS`).
- The existing attendance tests (248) must stay green at every step.

## 8. Step-by-Step Implementation Roadmap (each step needs separate approval)
1. **Schema:**
   - `burger_boost_settings` (max cap 5–50, default 20)
   - `burger_boost_sessions` (seed, telemetry, verified pct)
   - `burger_boost_coupons` (user_id, code, pct, status, issued_at, expires_at, redeemed_order_id)
   - `burger_boost_test_orders` and their items, with an idempotency key
2. **Grants + RLS** (depends on 1): customers can read their own sessions and coupons; only the Owner can manage settings; there are no direct client writes.
3. **RPCs** (depend on 2):
   - `bb_start_session`
   - `bb_submit_session` (server replay, capped pct)
   - `bb_issue_coupon`
   - `place_order_with_boost`
4. **Server functions** (depend on 3): `createServerFn` with auth middleware wrapping each RPC, plus a coupon resolver that routes BOOST codes.
5. **Tests** (alongside 3 and 4):
   - Option A formula and cap
   - 0% start
   - 2-decimal rounding
   - 7-day expiry
   - Single use
   - Concurrent redeem
   - Stacking rejection
   - Idempotent retry
   - Rollback on item failure
   - Attendance suite stays unchanged
6. **Owner settings page**, then the **game UI**.

## 9. Remaining Unresolved Risks
- The cancellation policy for redeemed BOOST coupons is not decided.
- The Production ordering schema has not been checked, so the adapter contract has to be matched against it later.
- Migration drift: the repo has ordering migrations that TEST does not have, and earlier retention DDL is not in Git.
- The cron schema cannot be read with the current access.
- Attendance table names were not checked again this turn; this report relies on the earlier audit.

## Final Readiness Verdict
**READY FOR IMPLEMENTATION PLANNING (Option A + C), WITH CONDITIONS:**
- The Owner decides the cancellation policy.
- Explicit approval is given for each roadmap step.

Stopped here, waiting for your approval.
