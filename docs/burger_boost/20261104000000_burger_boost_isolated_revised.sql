-- =====================================================================
-- FLAMIO BURGER BOOST — REVISED INACTIVE DRAFT (STEP 22E)
-- =====================================================================
-- STATUS: DOCUMENTATION ONLY. NOT A MIGRATION. NOT APPLIED. NOT DEPLOYED.
-- Target if ever approved: TEST Supabase ref avwrptztixaketchgmsh ONLY.
-- Production (flamio.bd) is strictly prohibited.
-- Requires separate, explicit Owner approval before any manual execution.
--
-- Supersedes for review purposes (does not replace):
--   docs/burger_boost/20261102000000_burger_boost_isolated.sql
--
-- Changes vs original:
--   1. Schema ACL: REVOKE ALL ... FROM PUBLIC, anon, authenticated,
--      service_role; then GRANT USAGE (only) TO service_role.
--   2. Default ACL preflight for CURRENT_USER and burger_boost_owner.
--   3. Restrictive attribute check on burger_boost_owner.
--   4. In-transaction postflight assertions (fail => full rollback).
--
-- Prerequisites (already provisioned in TEST per STEP 21B evidence):
--   P-1 role burger_boost_owner NOLOGIN NOSUPERUSER NOCREATEDB
--       NOCREATEROLE NOREPLICATION NOBYPASSRLS
--   P-2 GRANT burger_boost_owner TO <runner> WITH SET TRUE (PG16+)
--
-- Default ACL note (PG17): default privileges are applied using the
-- object OWNER. The schema (AUTHORIZATION) and all tables/sequence
-- (SET LOCAL ROLE) are owned by burger_boost_owner, so its rows are the
-- ones that take effect. CURRENT_USER schema-type ('n') global defaults
-- are also checked, per Owner instruction, and fail closed. Existing
-- default ACLs are never altered by this draft.
--
-- Scope: exactly 5 tables + 1 identity sequence. No functions, RPCs,
-- triggers, views, policies, seed rows, extra indexes, or FKs.
-- No DROP, no CASCADE. Existing roles/memberships untouched.
-- =====================================================================

BEGIN;

DO $preflight$
DECLARE
  exec_role name := CURRENT_USER;
  r record;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::int < 160000 THEN
    RAISE EXCEPTION 'BB preflight: PostgreSQL 16+ required';
  END IF;

  IF NOT pg_catalog.has_database_privilege(exec_role, pg_catalog.current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'BB preflight: % lacks database CREATE', exec_role;
  END IF;

  SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BB preflight: role burger_boost_owner absent';
  END IF;
  IF r.rolcanlogin OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
     OR r.rolreplication OR r.rolbypassrls THEN
    RAISE EXCEPTION 'BB preflight: burger_boost_owner attributes not restrictive';
  END IF;

  IF NOT pg_catalog.pg_has_role(exec_role, 'burger_boost_owner', 'SET') THEN
    RAISE EXCEPTION 'BB preflight: % cannot SET ROLE burger_boost_owner', exec_role;
  END IF;

  -- Client roles must not be able to assume the owner.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles c
    WHERE c.rolname IN ('anon','authenticated','service_role')
      AND pg_catalog.pg_has_role(c.rolname, 'burger_boost_owner', 'USAGE')
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles c
    WHERE c.rolname IN ('anon','authenticated','service_role')
      AND pg_catalog.pg_has_role(c.rolname, 'burger_boost_owner', 'SET')
  ) THEN
    RAISE EXCEPTION 'BB preflight: client role can assume burger_boost_owner';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost') THEN
    RAISE EXCEPTION 'BB preflight: schema burger_boost already exists';
  END IF;

  -- Owner role: ANY default ACL row (global or schema-scoped, any type)
  -- could shape new objects. Require none.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    JOIN pg_catalog.pg_roles o ON o.oid = d.defaclrole
    WHERE o.rolname = 'burger_boost_owner'
  ) THEN
    RAISE EXCEPTION 'BB preflight: default ACL rows exist FOR ROLE burger_boost_owner';
  END IF;

  -- Executing role: global schema-type ('n') defaults granting anything
  -- to PUBLIC or client roles => fail closed (not altered here).
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl d
    LEFT JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a ON true
    WHERE d.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = exec_role)
      AND d.defaclobjtype = 'n'
      AND d.defaclnamespace = 0
      AND (a.grantee = 0 OR a.grantee IN (
             SELECT oid FROM pg_catalog.pg_roles
             WHERE rolname IN ('anon','authenticated','service_role')))
  ) THEN
    RAISE EXCEPTION 'BB preflight: % has global schema default ACL for PUBLIC/client roles', exec_role;
  END IF;
END
$preflight$;

CREATE SCHEMA burger_boost AUTHORIZATION burger_boost_owner;

SET LOCAL ROLE burger_boost_owner;

-- Schema ACL correction (STEP 22D blocker): remove everything, then
-- grant USAGE only to service_role. No CREATE for any client role.
REVOKE ALL ON SCHEMA burger_boost FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA burger_boost TO service_role;

CREATE TABLE burger_boost.settings (
  singleton_key pg_catalog.bool        NOT NULL DEFAULT true,
  game_enabled  pg_catalog.bool        NOT NULL DEFAULT false,
  created_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_settings_pkey        PRIMARY KEY (singleton_key),
  CONSTRAINT bb_settings_singleton   CHECK (singleton_key = true),
  CONSTRAINT bb_settings_game_locked CHECK (game_enabled = false)
);

CREATE TABLE burger_boost.sessions (
  id                       pg_catalog.uuid         NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id                  pg_catalog.uuid         NOT NULL,
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

CREATE TABLE burger_boost.coupons (
  id                pg_catalog.uuid         NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id           pg_catalog.uuid         NOT NULL,
  code              pg_catalog.text         NOT NULL,
  discount_percent  pg_catalog.numeric(5,2) NOT NULL,
  status            pg_catalog.text         NOT NULL,
  issued_at         pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  expires_at        pg_catalog.timestamptz  NOT NULL,
  redeemed_at       pg_catalog.timestamptz,
  redeemed_order_id pg_catalog.uuid,
  CONSTRAINT bb_coupons_pkey          PRIMARY KEY (id),
  CONSTRAINT bb_coupons_code_key      UNIQUE (code),
  CONSTRAINT bb_coupons_phase1_locked CHECK (false)
);

CREATE TABLE burger_boost.redemptions (
  id                       pg_catalog.uuid        NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  user_id                  pg_catalog.uuid        NOT NULL,
  coupon_id                pg_catalog.uuid        NOT NULL,
  redeemed_at              pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  external_order_reference pg_catalog.text,
  created_at               pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_redemptions_pkey PRIMARY KEY (id)
);

CREATE TABLE burger_boost.audit_log (
  id            pg_catalog.int8        GENERATED ALWAYS AS IDENTITY,
  actor_user_id pg_catalog.uuid,
  event_type    pg_catalog.text        NOT NULL,
  entity_type   pg_catalog.text        NOT NULL,
  entity_id     pg_catalog.uuid,
  details       pg_catalog.jsonb       NOT NULL DEFAULT '{}'::pg_catalog.jsonb,
  created_at    pg_catalog.timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_audit_log_pkey PRIMARY KEY (id)
);

REVOKE ALL ON TABLE burger_boost.settings    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.sessions    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.coupons     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.redemptions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE burger_boost.audit_log   FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE burger_boost.audit_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE burger_boost.settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.coupons     ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE burger_boost.audit_log   ENABLE ROW LEVEL SECURITY;

-- Postflight (inside transaction; any failure rolls back everything).
DO $postflight$
DECLARE
  ns oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  own oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  svc oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role');
  clients oid[] := ARRAY(SELECT oid FROM pg_catalog.pg_roles
                         WHERE rolname IN ('anon','authenticated','service_role'));
BEGIN
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = ns) <> own THEN
    RAISE EXCEPTION 'BB postflight: schema owner mismatch';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_class
      WHERE relnamespace = ns AND relkind = 'r'
        AND relname IN ('settings','sessions','coupons','redemptions','audit_log')
        AND relowner = own AND relrowsecurity) <> 5
     OR (SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace = ns AND relkind = 'r') <> 5 THEN
    RAISE EXCEPTION 'BB postflight: expected exactly 5 owned RLS tables';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE relnamespace = ns AND relkind = 'S') <> 1
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                    WHERE relnamespace = ns AND relkind = 'S'
                      AND relname = 'audit_log_id_seq' AND relowner = own) THEN
    RAISE EXCEPTION 'BB postflight: expected exactly 1 owned identity sequence';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class
             WHERE relnamespace = ns AND relkind IN ('v','m','f','p')) THEN
    RAISE EXCEPTION 'BB postflight: unexpected relation kind';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
             JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
             WHERE c.relnamespace = ns) THEN
    RAISE EXCEPTION 'BB postflight: policies present';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = ns)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
                WHERE c.relnamespace = ns AND NOT t.tgisinternal)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                WHERE connamespace = ns AND contype = 'f') THEN
    RAISE EXCEPTION 'BB postflight: functions/triggers/FKs present';
  END IF;

  -- Schema ACL: only service_role USAGE among PUBLIC/client roles.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n,
         LATERAL pg_catalog.aclexplode(n.nspacl) a
    WHERE n.oid = ns
      AND (a.grantee = 0 OR a.grantee = ANY (clients))
      AND NOT (a.grantee = svc AND a.privilege_type = 'USAGE')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n,
         LATERAL pg_catalog.aclexplode(n.nspacl) a
    WHERE n.oid = ns AND a.grantee = svc AND a.privilege_type = 'USAGE'
  ) THEN
    RAISE EXCEPTION 'BB postflight: schema ACL not USAGE-only for service_role';
  END IF;

  -- Tables and sequence: zero privileges for PUBLIC/client roles.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c,
         LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.relnamespace = ns
      AND (a.grantee = 0 OR a.grantee = ANY (clients))
  ) THEN
    RAISE EXCEPTION 'BB postflight: client privileges on tables/sequence';
  END IF;
END
$postflight$;

RESET ROLE;
COMMIT;

-- No rollback block is included here; any rollback requires a separate,
-- reviewed, dependency-checked plan. DROP ... CASCADE is not permitted.
-- =====================================================================
