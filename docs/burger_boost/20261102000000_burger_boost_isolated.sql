-- =====================================================================
-- INACTIVE DOCUMENTATION DRAFT — NOT FOR EXECUTION
-- ---------------------------------------------------------------------
-- FLAMIO BURGER BOOST — STEP 06G / PROMPT 1 — ISOLATED SCHEMA (DDL ONLY)
-- Intended target : TEST project only (6832fa0f-633c-494c-b5c4-3d3906fe739d)
-- Created         : 2026-11-02
-- Status          : Documentation file under docs/. NOT a Supabase migration.
--                   No SQL has been executed. Nothing has been applied.
-- Production (flamio.bd), POS, Orders, Checkout, Attendance: out of scope.
--
-- Scope: schema burger_boost + exactly five tables:
--   settings, sessions, coupons, redemptions, audit_log
-- Excluded: RPCs, functions, SECURITY DEFINER, triggers, views, policies,
--   extra indexes, seeds/inserts, gameplay, replay, discount formula,
--   coupon issuance/redemption, checkout integration, client code,
--   cross-module FKs (no FKs to auth, orders, attendance, challenges).
--
-- Phase locks:
--   settings.game_enabled            NOT NULL DEFAULT false, CHECK (= false)
--   sessions.awarded_discount_percent NOT NULL DEFAULT 0,   CHECK (= 0)
--   sessions.rules_version            SMALLINT NOT NULL DEFAULT 1, CHECK (> 0)
--   sessions.idempotency_key          NOT NULL, UNIQUE bb_sessions_idempotency_key_key
--   coupons                           CHECK (false) — no row can be inserted
--
-- OWNERSHIP MODEL: Provisional Model A (STEP 06K/06L) — dedicated
--   NOLOGIN role "burger_boost_owner". Provisional only; NOT implementation
--   approval. This draft NEVER creates, alters, or grants any role.
--   Owner is never substituted with postgres, supabase_admin or service_role.
--   burger_boost_owner must hold NO privileges on public, auth, storage,
--   attendance, finance, customer, or any other existing Flamio schema.
--
-- EXTERNAL PREREQUISITES — NOT EXECUTED, NOT VERIFIED:
--   P-1: CREATE ROLE burger_boost_owner WITH NOLOGIN NOSUPERUSER NOCREATEDB
--          NOCREATEROLE NOREPLICATION NOBYPASSRLS;
--   P-2: GRANT burger_boost_owner TO postgres WITH INHERIT TRUE, SET TRUE;
--        - "WITH INHERIT/SET" option syntax is PostgreSQL 16+ only; on
--          PG<16 the equivalent is plain "GRANT burger_boost_owner TO postgres;".
--        - Grantee "postgres" is an ASSUMPTION. The real executing role of
--          each runner (Dashboard SQL Editor, Supabase CLI, CI) is
--          unverified; grant only to the role actually used.
--        - Compatibility with managed Supabase role restrictions unverified.
--   Never grant in the reverse direction (postgres TO burger_boost_owner).
--
-- UNRESOLVED BLOCKERS (execution stays BLOCKED until all are closed):
--   TODO-1: Live TEST catalog: does burger_boost_owner exist, safe flags?
--   TODO-B: TEST PostgreSQL major version (selects SET vs MEMBER check).
--   TODO-R: Actual executing role per migration runner.
--   TODO-E2: Default ACLs FOR ROLE <executing role> IN SCHEMA burger_boost
--            cannot exist for a new schema, but global defaults for the
--            executing role on TABLES must be reviewed live (pg_default_acl).
--   TODO-4: Grand Winner, score-to-discount formula, replay engine remain
--           out of scope (Step 06 blockers); no columns added for them.
--
-- FUTURE SECURITY DEFINER RPCs — DOCUMENTATION ONLY, NONE CREATED HERE.
--   Require separate approval and review of: dedicated function owner;
--   SECURITY DEFINER; SET search_path = ''; fully schema-qualified refs;
--   explicit EXECUTE grants; REVOKE from PUBLIC, anon, authenticated;
--   service_role EXECUTE only where justified; user identity verified on
--   the server, never client-supplied; atomic transaction + idempotency;
--   RLS / FORCE ROW LEVEL SECURITY implications (owners bypass RLS unless
--   forced); no privileges on existing Flamio schemas. Owning the tables
--   does NOT grant CREATE on schema public — wrapper placement is open.
-- =====================================================================

BEGIN;

-- Empty search_path for this transaction: every object/built-in below is
-- schema-qualified (pg_catalog is still implicitly searched by PostgreSQL).
SET LOCAL search_path = '';

-- =====================================================================
-- SAFETY CHECK 1 — Dedicated non-superuser owner verification (A)
-- SAFETY CHECK 1b — Executing-role membership / SET capability (B)
-- SAFETY CHECK 4 — Preserve existing burger_boost ownership/permissions
--                  and existing-object collision protection (C, D, E)
--
-- STEP 06L decision (Model A): a PRE-EXISTING burger_boost schema is
-- ALWAYS rejected, whatever its owner. Rationale:
--   * Its ACL (nspacl) and any default ACLs (pg_default_acl) cannot be
--     proven safe statically; the REVOKE/GRANT below would otherwise
--     rewrite unknown custom grants. Failing closed preserves them.
--   * Any object inside it (tables, views, matviews, sequences, composite
--     types, domains, enums, routines, foreign tables) could collide.
--     Rejecting the whole schema gives complete collision coverage
--     without having to enumerate every catalog.
--   * Nothing is dropped, renamed, or overwritten; an operator must
--     investigate manually.
-- Additionally, a schema-independent check rejects any existing
-- pg_default_acl rows that would target the burger_boost_owner role
-- (defaults scoped "FOR ROLE burger_boost_owner" would silently grant
-- privileges on every table created below).
-- =====================================================================
DO $preflight$
DECLARE
  r              pg_catalog.pg_roles%ROWTYPE;
  exec_role      pg_catalog.name := pg_catalog."current_user"();
  can_set        pg_catalog.bool;
  default_acls   pg_catalog.int8;
BEGIN
  -- (A) Role existence and attributes ---------------------------------
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'burger_boost preflight: role burger_boost_owner does not exist (external prerequisite P-1, NOT executed by this file)';
  END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
     OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'burger_boost preflight: role burger_boost_owner has unsafe attributes (must be NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS)';
  END IF;

  -- (B) Executing-role membership -------------------------------------
  -- The executing role is whatever current_user is at run time; it is NOT
  -- assumed to be postgres. ALTER ... OWNER TO requires that role to be
  -- able to SET ROLE to burger_boost_owner.
  -- PG16+: privilege 'SET' exists in pg_has_role and matches the exact
  --        ALTER OWNER requirement.
  -- PG<16: 'SET' is not a valid privilege name; 'MEMBER' is the closest
  --        documented equivalent (member of, directly or indirectly).
  -- TODO-B (BLOCKING): target PostgreSQL major version on TEST is
  --        unverified; both branches are statically plausible but neither
  --        has been executed.
  IF pg_catalog.current_setting('server_version_num')::pg_catalog.int4 >= 160000 THEN
    EXECUTE 'SELECT pg_catalog.pg_has_role($1, $2, $3)'
      INTO can_set USING exec_role, 'burger_boost_owner'::pg_catalog.name, 'SET'::pg_catalog.text;
  ELSE
    can_set := pg_catalog.pg_has_role(exec_role, 'burger_boost_owner', 'MEMBER');
  END IF;
  IF NOT can_set THEN
    RAISE EXCEPTION 'burger_boost preflight: executing role % cannot SET ROLE burger_boost_owner (external prerequisite P-2)', exec_role;
  END IF;

  -- (C)(D)(E) Pre-existing schema: always fail closed ------------------
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost') THEN
    RAISE EXCEPTION 'burger_boost preflight: schema burger_boost already exists — refusing to touch its ownership, ACLs, default ACLs or objects; investigate manually';
  END IF;

  -- (E) Default ACLs that would apply to objects created by the owner ---
  SELECT pg_catalog.count(*) INTO default_acls
  FROM pg_catalog.pg_default_acl d
  WHERE d.defaclrole = r.oid;
  IF default_acls > 0 THEN
    RAISE EXCEPTION 'burger_boost preflight: % default ACL row(s) exist for burger_boost_owner — would leak privileges onto new tables', default_acls;
  END IF;
  -- NOTE: default ACLs defined FOR ROLE <executing role> apply to objects
  -- that role creates. Tables below are created by the executing role and
  -- then re-owned; any such grants are explicitly revoked further down,
  -- but this is a residual review item (TODO-E2).
END
$preflight$;

-- Schema is guaranteed new here (preflight rejects any existing one), so
-- the REVOKE/GRANT below cannot overwrite pre-existing custom ACLs.
CREATE SCHEMA burger_boost;
ALTER SCHEMA burger_boost OWNER TO burger_boost_owner;

REVOKE ALL ON SCHEMA burger_boost FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA burger_boost TO service_role;

-- ---------------------------------------------------------------------
-- settings (singleton)
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.settings (
  singleton_key pg_catalog.bool        NOT NULL DEFAULT true,
  game_enabled  pg_catalog.bool        NOT NULL DEFAULT false,
  created_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_settings_pkey        PRIMARY KEY (singleton_key),
  CONSTRAINT bb_settings_singleton   CHECK (singleton_key = true),
  CONSTRAINT bb_settings_game_locked CHECK (game_enabled = false)
);

-- ---------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.sessions (
  id                       pg_catalog.uuid         NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id                  pg_catalog.uuid         NOT NULL,  -- no FK (isolated)
  idempotency_key          pg_catalog.text         NOT NULL,
  status                   pg_catalog.text         NOT NULL DEFAULT 'in_progress',
  seed                     pg_catalog.int8         NOT NULL,
  started_at               pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  expires_at               pg_catalog.timestamptz  NOT NULL,
  completed_at             pg_catalog.timestamptz,
  telemetry_hash           pg_catalog.text,
  verified_score           pg_catalog.int4         NOT NULL DEFAULT 0,
  awarded_discount_percent pg_catalog.numeric(5,2) NOT NULL DEFAULT 0,
  rules_version            pg_catalog.int2         NOT NULL DEFAULT 1,
  created_at               pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  updated_at               pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_sessions_pkey                PRIMARY KEY (id),
  CONSTRAINT bb_sessions_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT bb_sessions_status_check        CHECK (status IN ('in_progress','completed','expired','rejected')),
  CONSTRAINT bb_sessions_score_nonneg        CHECK (verified_score >= 0),
  CONSTRAINT bb_sessions_discount_locked     CHECK (awarded_discount_percent = 0),
  CONSTRAINT bb_sessions_rules_version_pos   CHECK (rules_version > 0)
);

-- ---------------------------------------------------------------------
-- coupons (issuance disabled: CHECK (false))
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.coupons (
  id                pg_catalog.uuid         NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id           pg_catalog.uuid         NOT NULL,  -- no FK
  code              pg_catalog.text         NOT NULL,
  discount_percent  pg_catalog.numeric(5,2) NOT NULL,
  status            pg_catalog.text         NOT NULL,
  issued_at         pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  expires_at        pg_catalog.timestamptz  NOT NULL,
  redeemed_at       pg_catalog.timestamptz,
  redeemed_order_id pg_catalog.uuid,                  -- no FK (checkout isolated)
  CONSTRAINT bb_coupons_pkey          PRIMARY KEY (id),
  CONSTRAINT bb_coupons_code_key      UNIQUE (code),
  CONSTRAINT bb_coupons_phase1_locked CHECK (false)
);

-- ---------------------------------------------------------------------
-- redemptions (no order integration)
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.redemptions (
  id                       pg_catalog.uuid        NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id                  pg_catalog.uuid        NOT NULL,  -- no FK
  coupon_id                pg_catalog.uuid        NOT NULL,  -- no FK
  redeemed_at              pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  external_order_reference pg_catalog.text,                  -- plain text, not an FK
  created_at               pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_redemptions_pkey PRIMARY KEY (id)
);

-- ---------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------
CREATE TABLE burger_boost.audit_log (
  id            pg_catalog.int8        GENERATED ALWAYS AS IDENTITY,
  actor_user_id pg_catalog.uuid,                 -- no FK
  event_type    pg_catalog.text        NOT NULL,
  entity_type   pg_catalog.text        NOT NULL,
  entity_id     pg_catalog.uuid,
  details       pg_catalog.jsonb       NOT NULL DEFAULT '{}'::pg_catalog.jsonb,
  created_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_audit_log_pkey PRIMARY KEY (id)
);

-- Ownership (dedicated role only; see TODO-2)
ALTER TABLE burger_boost.settings    OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.sessions    OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.coupons     OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.redemptions OWNER TO burger_boost_owner;
ALTER TABLE burger_boost.audit_log   OWNER TO burger_boost_owner;

-- No direct table privileges for anyone, including service_role.
REVOKE ALL ON TABLE burger_boost.settings    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.sessions    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.coupons     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.redemptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.audit_log   FROM PUBLIC, anon, authenticated, service_role;

-- Baseline RLS, zero policies (deny-all).
ALTER TABLE burger_boost.settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.coupons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.audit_log   ENABLE ROW LEVEL SECURITY;

COMMIT;

-- =====================================================================
-- DRAFT-TIME VERIFICATION (comments only — NOT to be executed now)
-- =====================================================================
--
-- SAFETY CHECK 1 — Dedicated non-superuser owner verification
--   SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
--          rolreplication, rolbypassrls
--   FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner';
--   Expect: one row, all flags false.
--   SELECT n.nspname, c.relname, pg_catalog.pg_get_userbyid(c.relowner)
--   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'burger_boost' AND c.relkind = 'r';
--   Expect: five rows, owner burger_boost_owner.
--
-- SAFETY CHECK 2 — NOT NULL checks
--   SELECT table_name, column_name, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'burger_boost'
--     AND column_name IN ('game_enabled','awarded_discount_percent','idempotency_key');
--   Expect: is_nullable = 'NO' for all three; plus constraints
--   bb_settings_game_locked, bb_sessions_discount_locked,
--   bb_sessions_idempotency_key_key present in pg_catalog.pg_constraint.
--
-- SAFETY CHECK 3 — RLS enabled on all five tables, zero client policies
--   SELECT c.relname, c.relrowsecurity FROM pg_catalog.pg_class c
--   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'burger_boost' AND c.relkind = 'r';
--   Expect: five rows, relrowsecurity = true.
--   SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'burger_boost';
--   Expect: 0.
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'burger_boost'
--     AND grantee IN ('PUBLIC','anon','authenticated','service_role');
--   Expect: 0 rows.
--
-- SAFETY CHECK 4 — Preserve existing burger_boost ownership/permissions
--   Enforced by the fail-closed preflight DO block above: ANY pre-existing
--   burger_boost schema is rejected (STEP 06L), as are default ACL rows for
--   burger_boost_owner; the transaction aborts. Before any future
--   run, capture: SELECT nspname, nspowner::regrole, nspacl
--   FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost';  (TODO-3)
--
-- SAFETY CHECK 5 — Existing migration checksum comparison (51 files)
--   Shell, from project root, before and after any change:
--     sha256sum supabase/migrations/*.sql > /tmp/before.sha
--     ... change ...
--     sha256sum supabase/migrations/*.sql | diff - /tmp/before.sha
--   Expect: count 51, no differences. This docs/ file is not in that set.
-- =====================================================================
