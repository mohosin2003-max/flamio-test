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
-- OWNER ROLE PREREQUISITE (NOT DONE HERE):
--   Role name "burger_boost_owner" is the name given in the owner-authorized
--   Prompt 1 instruction. This draft NEVER creates or alters any role.
--   Provisioning it (NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
--   NOREPLICATION NOBYPASSRLS) is a separate, owner-approved prerequisite.
--   Owner is never substituted with postgres, supabase_admin or service_role.
--
-- UNRESOLVED PREFLIGHT ITEMS (must be closed before any future execution):
--   TODO-1: Confirm burger_boost_owner exists in TEST with the safe attributes.
--   TODO-2: Confirm the executing migration role is allowed to
--           ALTER ... OWNER TO burger_boost_owner (membership requirement).
--   TODO-3: Existing ACLs on a pre-existing burger_boost schema cannot be
--           proven statically; the preflight below fails closed instead of
--           overwriting an unknown owner.
--   TODO-4: Grand Winner, score-to-discount formula, replay engine remain
--           out of scope (Step 06 blockers); no columns added for them.
-- =====================================================================

BEGIN;

-- Empty search_path for this transaction: every object/built-in below is
-- schema-qualified (pg_catalog is still implicitly searched by PostgreSQL).
SET LOCAL search_path = '';

-- =====================================================================
-- SAFETY CHECK 1 — Dedicated non-superuser owner verification
-- SAFETY CHECK 4 — Preserve existing burger_boost ownership/permissions
--   (Fail-closed. Raises if role missing/unsafe, if an existing schema has
--    an unexpected owner, or if any target table name already exists.
--    No CREATE TABLE IF NOT EXISTS is used, so collisions cannot be masked.)
-- =====================================================================
DO $preflight$
DECLARE
  r              pg_catalog.pg_roles%ROWTYPE;
  schema_owner   pg_catalog.name;
  conflict_count pg_catalog.int8;
BEGIN
  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'burger_boost preflight: role burger_boost_owner does not exist (separate prerequisite, TODO-1)';
  END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
     OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'burger_boost preflight: role burger_boost_owner has unsafe attributes';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(n.nspowner) INTO schema_owner
  FROM pg_catalog.pg_namespace n WHERE n.nspname = 'burger_boost';

  IF FOUND THEN
    IF schema_owner IS DISTINCT FROM 'burger_boost_owner' THEN
      RAISE EXCEPTION 'burger_boost preflight: existing schema owned by unexpected role % — not overwriting', schema_owner;
    END IF;
    SELECT pg_catalog.count(*) INTO conflict_count
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'burger_boost'
      AND c.relname IN ('settings','sessions','coupons','redemptions','audit_log');
    IF conflict_count > 0 THEN
      RAISE EXCEPTION 'burger_boost preflight: % conflicting target relation(s) already exist', conflict_count;
    END IF;
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS burger_boost;
-- No-op when the preflight accepted an existing schema (already this owner).
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
--   Enforced by the fail-closed preflight DO block above: an existing schema
--   is accepted only if owned by burger_boost_owner and free of all five
--   target table names; otherwise the transaction aborts. Before any future
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
