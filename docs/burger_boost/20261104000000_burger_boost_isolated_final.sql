-- =====================================================================
-- FLAMIO BURGER BOOST — FINAL INACTIVE DRAFT (STEP 22H)
-- =====================================================================
-- STATUS: DOCUMENTATION ONLY. NOT A MIGRATION. NOT APPLIED. NOT DEPLOYED.
-- Target if ever approved: TEST Supabase ref avwrptztixaketchgmsh ONLY.
-- Production (flamio.bd) is strictly prohibited.
-- Requires separate, explicit Owner approval before any manual execution.
--
-- Supersedes for review purposes (does not replace or modify):
--   docs/burger_boost/20261102000000_burger_boost_isolated.sql
--   docs/burger_boost/20261104000000_burger_boost_isolated_revised.sql
--
-- Changes vs revised draft (STEP 22H):
--   1. Postflight inspects EVERY explicit nspacl entry; only the owner
--      and service_role USAGE are permitted.
--   2. Effective schema privileges via has_schema_privilege() for anon,
--      authenticated, service_role, and authenticator (if it exists).
--   3. Effective table/sequence privileges via has_table_privilege() /
--      has_sequence_privilege() (these include inherited memberships).
--   4. Postflight inspects EVERY explicit relacl entry on every relation
--      in the schema; only the object owner is permitted.
--   5. Executing-role global schema default ACL check now rejects ANY
--      non-owner grantee (not just three named roles).
--
-- PostgreSQL default-ACL behavior (PG17 source: NamespaceCreate and
-- heap_create_with_catalog call get_user_default_acl(..., ownerId, ...)):
--   * Schema defaults are looked up for the schema OWNER
--     (burger_boost_owner via AUTHORIZATION), not the executing role.
--   * Tables and the identity sequence are created after SET LOCAL ROLE,
--     so their owner (and default-ACL role) is burger_boost_owner.
--   The owner check (any object type) is therefore the effective one;
--   the executing-role schema check is an extra fail-closed guard.
--   Existing default ACLs are never altered by this draft.
--
-- Prerequisites (provisioned in TEST per STEP 21B evidence):
--   P-1 role burger_boost_owner NOLOGIN NOSUPERUSER NOCREATEDB
--       NOCREATEROLE NOREPLICATION NOBYPASSRLS
--   P-2 GRANT burger_boost_owner TO <runner> WITH SET TRUE (PG16+)
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

  -- Client/gateway roles must not be able to assume or inherit the owner.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles c
    WHERE c.rolname IN ('anon','authenticated','service_role','authenticator')
      AND (pg_catalog.pg_has_role(c.oid, r.oid, 'USAGE')
           OR pg_catalog.pg_has_role(c.oid, r.oid, 'SET'))
  ) THEN
    RAISE EXCEPTION 'BB preflight: client role can assume burger_boost_owner';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost') THEN
    RAISE EXCEPTION 'BB preflight: schema burger_boost already exists';
  END IF;

  -- Owner role: ANY default ACL row (global or schema-scoped, any type).
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_default_acl d
    WHERE d.defaclrole = r.oid
  ) THEN
    RAISE EXCEPTION 'BB preflight: default ACL rows exist FOR ROLE burger_boost_owner';
  END IF;

  -- Executing role: ANY global schema-type default granting to any
  -- grantee other than the executing role itself (incl. PUBLIC = 0).
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl d
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE d.defaclrole = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = exec_role)
      AND d.defaclobjtype = 'n'
      AND d.defaclnamespace = 0
      AND a.grantee <> d.defaclrole
  ) THEN
    RAISE EXCEPTION 'BB preflight: % has global schema default ACL for a non-owner grantee', exec_role;
  END IF;
END
$preflight$;

CREATE SCHEMA burger_boost AUTHORIZATION burger_boost_owner;

SET LOCAL ROLE burger_boost_owner;

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
  ns  oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'burger_boost');
  own oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'burger_boost_owner');
  svc oid := (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role');
  cr  record;
  rel record;
  p   text;
BEGIN
  -- 1. Ownership.
  IF ns IS NULL OR own IS NULL OR svc IS NULL THEN
    RAISE EXCEPTION 'BB postflight: schema/owner/service_role missing';
  END IF;
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = ns) <> own THEN
    RAISE EXCEPTION 'BB postflight: schema owner mismatch';
  END IF;

  -- 2. Exactly 5 owned RLS tables, exactly 1 owned identity sequence.
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

  -- 3. Only constraint-backed indexes (3 PK/UNIQUE pairs + PKs = 7).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class
             WHERE relnamespace = ns AND relkind NOT IN ('r','S','i')) THEN
    RAISE EXCEPTION 'BB postflight: unexpected relation kind';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_index x
             JOIN pg_catalog.pg_class c ON c.oid = x.indexrelid
             WHERE c.relnamespace = ns
               AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                               WHERE k.conindid = x.indexrelid
                                 AND k.contype IN ('p','u'))) THEN
    RAISE EXCEPTION 'BB postflight: extra (non-constraint) index present';
  END IF;

  -- 4. Zero policies, functions, user triggers, FKs.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p2
             JOIN pg_catalog.pg_class c ON c.oid = p2.polrelid
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

  -- 5. All-role schema ACL: every explicit entry must be the owner, or
  --    service_role USAGE (non-grantable). Anything else aborts.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
    WHERE n.oid = ns
      AND a.grantee <> own
      AND NOT (a.grantee = svc AND a.privilege_type = 'USAGE' AND NOT a.is_grantable)
  ) THEN
    RAISE EXCEPTION 'BB postflight: unapproved explicit schema ACL entry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
    WHERE n.oid = ns AND a.grantee = svc AND a.privilege_type = 'USAGE'
  ) THEN
    RAISE EXCEPTION 'BB postflight: service_role USAGE missing';
  END IF;

  -- 6. All-role table/sequence ACL: every explicit entry must be the
  --    owner. relacl must be non-NULL (explicit) after the REVOKEs.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class
             WHERE relnamespace = ns AND relkind IN ('r','S') AND relacl IS NULL) THEN
    RAISE EXCEPTION 'BB postflight: relation ACL unexpectedly NULL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.relnamespace = ns AND c.relkind IN ('r','S')
      AND a.grantee <> own
  ) THEN
    RAISE EXCEPTION 'BB postflight: unapproved explicit table/sequence ACL entry';
  END IF;

  -- 7. Effective privileges (includes inherited memberships and PUBLIC).
  FOR cr IN SELECT oid, rolname FROM pg_catalog.pg_roles
            WHERE rolname IN ('anon','authenticated','service_role','authenticator')
  LOOP
    IF pg_catalog.has_schema_privilege(cr.oid, ns, 'CREATE') THEN
      RAISE EXCEPTION 'BB postflight: % has effective schema CREATE', cr.rolname;
    END IF;
    IF cr.rolname = 'service_role' THEN
      IF NOT pg_catalog.has_schema_privilege(cr.oid, ns, 'USAGE') THEN
        RAISE EXCEPTION 'BB postflight: service_role lacks effective schema USAGE';
      END IF;
    ELSIF pg_catalog.has_schema_privilege(cr.oid, ns, 'USAGE') THEN
      RAISE EXCEPTION 'BB postflight: % has effective schema USAGE', cr.rolname;
    END IF;

    IF cr.rolname <> 'authenticator' THEN
      FOR rel IN SELECT oid, relname, relkind FROM pg_catalog.pg_class
                 WHERE relnamespace = ns AND relkind IN ('r','S')
      LOOP
        IF rel.relkind = 'r' THEN
          FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
            IF pg_catalog.has_table_privilege(cr.oid, rel.oid, p) THEN
              RAISE EXCEPTION 'BB postflight: % has effective % on %', cr.rolname, p, rel.relname;
            END IF;
          END LOOP;
        ELSE
          FOREACH p IN ARRAY ARRAY['USAGE','SELECT','UPDATE'] LOOP
            IF pg_catalog.has_sequence_privilege(cr.oid, rel.oid, p) THEN
              RAISE EXCEPTION 'BB postflight: % has effective % on %', cr.rolname, p, rel.relname;
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'BB postflight: expected client roles anon/authenticated missing';
  END IF;
END
$postflight$;

RESET ROLE;
COMMIT;

-- No rollback block is included here; any rollback requires a separate,
-- reviewed, dependency-checked plan. DROP ... CASCADE is not permitted.
-- =====================================================================
