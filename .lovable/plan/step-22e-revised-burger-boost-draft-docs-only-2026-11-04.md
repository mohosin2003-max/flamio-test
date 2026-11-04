# STEP 22E — Revised Burger Boost Draft (docs only)

## Scope
Create one new inactive documentation file. Nothing else changes.

- New: `docs/burger_boost/20261104000000_burger_boost_isolated_revised.sql`
- Untouched: original draft (SHA-256 `c945fccb...96b0`, verified now), all 51 files in `supabase/migrations/`, app code, config, database, Production.

## Content of the revised draft
1. Header: inactive, not a migration, TEST `avwrptztixaketchgmsh` only, do not execute without separate Owner approval.
2. `BEGIN;` single transaction; any exception rolls back everything.
3. Preflight DO block (fail closed with RAISE EXCEPTION):
   - PG >= 16 (target 17.11), `current_database()` sanity note.
   - `exec_role := CURRENT_USER`; has database CREATE; `pg_has_role(exec_role,'burger_boost_owner','SET')`.
   - `burger_boost_owner` exists with NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS.
   - Schema `burger_boost` absent.
   - `pg_default_acl` check for both CURRENT_USER and `burger_boost_owner`: any global row (defaclnamespace = 0) for object types `n`, `r`, `S` granting to PUBLIC/anon/authenticated/service_role -> exception. Schema-scoped rows cannot exist yet (schema absent). Existing defaults are never altered.
4. `CREATE SCHEMA burger_boost AUTHORIZATION burger_boost_owner;`
5. `REVOKE ALL ON SCHEMA burger_boost FROM PUBLIC, anon, authenticated, service_role;` then `GRANT USAGE ON SCHEMA burger_boost TO service_role;` (no CREATE).
6. `SET LOCAL ROLE burger_boost_owner;` then the same five tables with phase locks (game_enabled CHECK false, awarded_discount_percent CHECK 0, coupons CHECK(false)), one identity sequence `audit_log_id_seq`.
7. Per-table and sequence `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;` and `ENABLE ROW LEVEL SECURITY` on all five; zero policies.
8. In-transaction postflight DO block asserting: schema owner, 5 tables + 1 sequence owned by `burger_boost_owner`, RLS on, 0 policies, schema ACL for service_role = USAGE only and nothing for others, no table/sequence ACL entries for client roles. Fails -> rollback.
9. `RESET ROLE; COMMIT;` No DROP CASCADE, no functions/triggers/views/seeds/FKs.

## Validation (static only, no SQL execution)
- Recompute SHA-256 of new file; reconfirm original still `c945fccb...96b0`; confirm 51 migration hashes unchanged.
- Statement-by-statement review for PG17 syntax, ownership, ACLs, rollback safety, object counts.

## Known limitation reported in final verdict
The default-ACL guard is only proven by reading at execution time; current live `pg_default_acl` rows for `postgres` (seen in STEP 08D as broad Supabase defaults) may trip the guard. If so, the draft fails closed and the verdict will state that clearing it would require changing existing database config (not permitted) — the explicit post-create REVOKEs remain the effective protection. Final verdict will be READY FOR SEPARATE OWNER REVIEW only if this is acceptable as fail-closed behavior; otherwise NOT READY.
