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
-- STEP 04F revision (inactive draft only):
--   * sessions.verified_score is nullable; completed rows require score,
--     telemetry_hash, completed_at; other statuses require all three NULL.
--   * Four SECURITY DEFINER RPCs (create_session, get_session_for_user,
--     complete_session, transition_session), owned by burger_boost_owner,
--     search_path = pg_catalog, burger_boost, pg_temp; EXECUTE to
--     service_role only. No direct table/sequence privileges for any
--     client or service role. Owner needs no grants beyond ownership.
--   * Game, discount and coupon phase locks unchanged.
--
-- Prerequisites (provisioned in TEST per STEP 21B evidence):
--   P-1 role burger_boost_owner NOLOGIN NOSUPERUSER NOCREATEDB
--       NOCREATEROLE NOREPLICATION NOBYPASSRLS
--   P-2 GRANT burger_boost_owner TO <runner> WITH SET TRUE (PG16+)
--
-- SECURITY NOTES (STEP 22K-H; based on observed TEST catalog evidence,
-- re-asserted where enforceable by the pre/postflight blocks):
--   * postgres is a member of service_role (S-1; verified TEST catalog
--     state: grantor=supabase_admin, ADMIN=t, INHERIT=t, SET=t). Because
--     INHERIT is enabled, service_role's schema USAGE is also effectively
--     available to postgres. This draft does not change that membership.
--   * postgres and service_role both have BYPASSRLS=true in TEST.
--     RLS (enabled, zero policies) is NOT a protective boundary against
--     them; it only fails closed for non-bypass roles.
--   * Table/sequence ACL revocation (REVOKE ALL ... FROM service_role
--     etc.) is the primary DML access boundary. Postflight verifies it
--     with has_table_privilege()/has_sequence_privilege(), which include
--     inherited memberships and PUBLIC. postgres is NOT covered by those
--     checks: it can SET ROLE burger_boost_owner (M-2) by design.
--   * CHECK constraints (phase locks) are data-integrity controls, not
--     authorization controls.
--   * burger_boost_owner must remain NOLOGIN, NOSUPERUSER, NOCREATEDB,
--     NOCREATEROLE, NOREPLICATION, NOBYPASSRLS (asserted pre and post).
--   * Superuser set {supabase_admin} is an EVIDENCE-DEPENDENT assertion
--     (historical TEST evidence only, not freshly verified). Any other
--     superuser aborts the transaction (fail closed).
--   * postgres and supabase_admin are exempt only from the general
--     role-graph sweep; postgres is separately asserted SET=true,
--     USAGE=false, and both appear only in the exact M-1/M-2 rows.
--   * No broad grants; no implicit trust in platform roles.
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

  -- STEP 22K-G: explicit accepted owner-membership model.
  -- pg_has_role() does NOT evaluate ADMIN OPTION, so pg_auth_members is
  -- inspected row by row. Accepted rows (each evaluated individually):
  --   M-1 member=postgres grantor=supabase_admin ADMIN=t INHERIT=f SET=f
  --       (observed platform-issued grant; accepted, not modified)
  --   M-2 member=postgres grantor=postgres       ADMIN=f INHERIT=f SET=t
  --       (runner SET path required for SET LOCAL ROLE)
  -- Any other row, any differing flag, or a missing row aborts.
  IF exec_role <> 'postgres' THEN
    RAISE EXCEPTION 'BB preflight: runner must be postgres (got %)', exec_role;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.grantor
    WHERE m.roleid = r.oid
      AND NOT (
        (mb.rolname = 'postgres' AND gr.rolname = 'supabase_admin'
         AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
        OR
        (mb.rolname = 'postgres' AND gr.rolname = 'postgres'
         AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
      )
  ) THEN
    RAISE EXCEPTION 'BB preflight: unexpected burger_boost_owner membership row/flags';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
      JOIN pg_catalog.pg_roles gr ON gr.oid = m.grantor
      WHERE m.roleid = r.oid AND mb.rolname = 'postgres'
        AND gr.rolname IN ('supabase_admin','postgres')) <> 2 THEN
    RAISE EXCEPTION 'BB preflight: accepted owner membership rows M-1/M-2 not both present';
  END IF;

  -- Owner must not itself be a member of any role (no inherited extras).
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid) THEN
    RAISE EXCEPTION 'BB preflight: burger_boost_owner is a member of another role';
  END IF;

  -- Superusers bypass all checks; accepted set is exactly {supabase_admin}.
  -- STEP 22K-I: supabase_admin must exist AND be superuser (evidence-dependent).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                 WHERE rolname = 'supabase_admin' AND rolsuper) THEN
    RAISE EXCEPTION 'BB preflight: supabase_admin absent or not superuser';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolsuper AND rolname <> 'supabase_admin') THEN
    RAISE EXCEPTION 'BB preflight: unexpected superuser role present';
  END IF;

  -- STEP 22K-I / STEP 02C: verified TEST catalog state of the
  -- postgres -> service_role membership (S-1):
  -- grantor=supabase_admin ADMIN=t INHERIT=t SET=t. Exactly one row.
  -- Kept separate from owner rows M-1/M-2. Not modified by this draft.
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
      JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
      WHERE mb.rolname = 'postgres' AND gr.rolname = 'service_role') <> 1
     OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
      JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
      JOIN pg_catalog.pg_roles gt ON gt.oid = m.grantor
      WHERE mb.rolname = 'postgres' AND gr.rolname = 'service_role'
        AND gt.rolname = 'supabase_admin'
        AND m.admin_option AND m.inherit_option AND m.set_option) THEN
    RAISE EXCEPTION 'BB preflight: postgres->service_role membership S-1 missing, duplicated or changed';
  END IF;

  -- Complete role graph (direct AND indirect, all roles incl. custom and
  -- platform): only the owner, postgres (SET via M-2) and the accepted
  -- superuser may reach burger_boost_owner via SET or USAGE.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles c
    WHERE c.oid <> r.oid
      AND c.rolname NOT IN ('postgres','supabase_admin')
      AND (pg_catalog.pg_has_role(c.oid, r.oid, 'USAGE')
           OR pg_catalog.pg_has_role(c.oid, r.oid, 'SET'))
  ) THEN
    RAISE EXCEPTION 'BB preflight: unapproved role can assume/inherit burger_boost_owner';
  END IF;
  -- postgres must reach owner by SET only, never by inheritance.
  IF pg_catalog.pg_has_role('postgres', r.oid, 'USAGE') THEN
    RAISE EXCEPTION 'BB preflight: postgres inherits burger_boost_owner';
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
  verified_score           pg_catalog.int4,
  awarded_discount_percent pg_catalog.numeric(5,2) NOT NULL DEFAULT 0,
  rules_version            pg_catalog.int2         NOT NULL DEFAULT 1,
  created_at               pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  updated_at               pg_catalog.timestamptz  NOT NULL DEFAULT pg_catalog.now(),
  CONSTRAINT bb_sessions_pkey                PRIMARY KEY (id),
  CONSTRAINT bb_sessions_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT bb_sessions_status_check        CHECK (status IN ('in_progress','completed','expired','rejected')),
  CONSTRAINT bb_sessions_score_nonneg        CHECK (verified_score IS NULL OR verified_score >= 0),
  -- STEP 04F: lifecycle consistency. Score 0 is a valid completed score.
  CONSTRAINT bb_sessions_completion_consistency CHECK (
    (status = 'completed'
       AND verified_score IS NOT NULL AND telemetry_hash IS NOT NULL AND completed_at IS NOT NULL)
    OR
    (status IN ('in_progress','expired','rejected')
       AND verified_score IS NULL AND telemetry_hash IS NULL AND completed_at IS NULL)
  ),
  CONSTRAINT bb_sessions_window_75s          CHECK (expires_at = started_at + pg_catalog.make_interval(secs => 75)),
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

-- ---------------------------------------------------------------------
-- STEP 04F: exactly four narrow SECURITY DEFINER RPCs, created while
-- SET LOCAL ROLE burger_boost_owner is active (so owner = definer).
-- Policy: fixed search_path pg_catalog, burger_boost, pg_temp (pg_temp
-- last); every table/function reference is schema-qualified; no
-- dynamic SQL (no EXECUTE). Server replay validation remains
-- authoritative; these checks are defense-in-depth only.
-- ---------------------------------------------------------------------

-- RPC 1. Idempotent create.
--   STEP 04G-FIX: p_id is the caller-supplied (core-generated) primary key.
--   Same user + same key + identical (id, seed, rules_version, started_at,
--   expires_at) -> returns the existing id (no second row).
--   Same user + same key + any differing field -> rejects (22023/P0001).
--   Different user's key -> rejects with the SAME generic message; no
--   id, status or field of the other session is returned.
--   Race-safe: INSERT ... ON CONFLICT DO NOTHING, then re-read.
CREATE FUNCTION burger_boost.create_session(
  p_id              pg_catalog.uuid,
  p_user_id         pg_catalog.uuid,
  p_seed            pg_catalog.int8,
  p_rules_version   pg_catalog.int2,
  p_idempotency_key pg_catalog.text,
  p_started_at      pg_catalog.timestamptz,
  p_expires_at      pg_catalog.timestamptz
) RETURNS pg_catalog.uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
DECLARE
  v_id pg_catalog.uuid;
  e    record;
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL OR p_seed IS NULL OR p_rules_version IS NULL
     OR p_rules_version <= 0
     OR p_idempotency_key IS NULL OR pg_catalog.length(p_idempotency_key) = 0
     OR p_started_at IS NULL OR p_expires_at IS NULL
     OR NOT pg_catalog.isfinite(p_started_at) OR NOT pg_catalog.isfinite(p_expires_at)
     OR p_expires_at <> p_started_at + pg_catalog.make_interval(secs => 75) THEN
    RAISE EXCEPTION 'BB create_session: invalid input' USING ERRCODE = '22023';
  END IF;

  INSERT INTO burger_boost.sessions
    (id, user_id, idempotency_key, status, seed, started_at, expires_at,
     completed_at, telemetry_hash, verified_score, awarded_discount_percent, rules_version)
  VALUES
    (p_id, p_user_id, p_idempotency_key, 'in_progress', p_seed, p_started_at, p_expires_at,
     NULL, NULL, NULL, 0, p_rules_version)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING burger_boost.sessions.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  SELECT s.id, s.user_id, s.seed, s.rules_version, s.started_at, s.expires_at
    INTO e
    FROM burger_boost.sessions s
   WHERE s.idempotency_key = p_idempotency_key;

  IF e.id IS NOT NULL
     AND e.id = p_id
     AND e.user_id = p_user_id
     AND e.seed = p_seed
     AND e.rules_version = p_rules_version
     AND e.started_at = p_started_at
     AND e.expires_at = p_expires_at THEN
    RETURN e.id;
  END IF;

  RAISE EXCEPTION 'BB create_session: idempotency key conflict' USING ERRCODE = 'P0001';
END
$fn$;

-- RPC 2. Owner-scoped read; 0 rows if absent or owned by another user.
CREATE FUNCTION burger_boost.get_session_for_user(
  p_id      pg_catalog.uuid,
  p_user_id pg_catalog.uuid
) RETURNS TABLE (
  id                       pg_catalog.uuid,
  user_id                  pg_catalog.uuid,
  idempotency_key          pg_catalog.text,
  status                   pg_catalog.text,
  seed                     pg_catalog.int8,
  started_at               pg_catalog.timestamptz,
  expires_at               pg_catalog.timestamptz,
  completed_at             pg_catalog.timestamptz,
  verified_score           pg_catalog.int4,
  telemetry_hash           pg_catalog.text,
  awarded_discount_percent pg_catalog.numeric,
  rules_version            pg_catalog.int2
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
  SELECT s.id, s.user_id, s.idempotency_key, s.status, s.seed,
         s.started_at, s.expires_at, s.completed_at, s.verified_score,
         s.telemetry_hash, s.awarded_discount_percent, s.rules_version
    FROM burger_boost.sessions s
   WHERE s.id = p_id
     AND s.user_id = p_user_id;
$fn$;

-- RPC 3. Atomic completion. Returns false (no update) unless ALL hold:
--   row id/user match; status = 'in_progress';
--   p_completed_at finite AND started_at <= p_completed_at <= expires_at;
--   expires_at = started_at + 75 seconds;
--   p_verified_score >= 0; p_telemetry_hash is 64 lowercase hex chars.
-- Invalid inputs are rejected without updating (returns false).
CREATE FUNCTION burger_boost.complete_session(
  p_id             pg_catalog.uuid,
  p_user_id        pg_catalog.uuid,
  p_verified_score pg_catalog.int4,
  p_telemetry_hash pg_catalog.text,
  p_completed_at   pg_catalog.timestamptz
) RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL
     OR p_verified_score IS NULL OR p_verified_score < 0
     OR p_telemetry_hash IS NULL OR p_telemetry_hash !~ '^[0-9a-f]{64}$'
     OR p_completed_at IS NULL OR NOT pg_catalog.isfinite(p_completed_at) THEN
    RETURN false;
  END IF;

  UPDATE burger_boost.sessions s
     SET status         = 'completed',
         verified_score = p_verified_score,
         telemetry_hash = p_telemetry_hash,
         completed_at   = p_completed_at,
         updated_at     = pg_catalog.now()
   WHERE s.id = p_id
     AND s.user_id = p_user_id
     AND s.status = 'in_progress'
     AND p_completed_at >= s.started_at
     AND p_completed_at <= s.expires_at
     AND s.expires_at = s.started_at + pg_catalog.make_interval(secs => 75);

  RETURN FOUND;
END
$fn$;

-- RPC 4. Atomic terminal transition to 'expired' or 'rejected' only.
-- Completion fields stay NULL (enforced by the consistency CHECK).
CREATE FUNCTION burger_boost.transition_session(
  p_id            pg_catalog.uuid,
  p_user_id       pg_catalog.uuid,
  p_target_status pg_catalog.text
) RETURNS pg_catalog.bool
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, burger_boost, pg_temp
AS $fn$
BEGIN
  IF p_id IS NULL OR p_user_id IS NULL
     OR p_target_status IS NULL OR p_target_status NOT IN ('expired','rejected') THEN
    RETURN false;
  END IF;

  UPDATE burger_boost.sessions s
     SET status     = p_target_status,
         updated_at = pg_catalog.now()
   WHERE s.id = p_id
     AND s.user_id = p_user_id
     AND s.status = 'in_progress';

  RETURN FOUND;
END
$fn$;

-- Function ACLs: EXECUTE for service_role only.
REVOKE ALL ON FUNCTION burger_boost.create_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.int2, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.complete_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION burger_boost.transition_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION burger_boost.create_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int8, pg_catalog.int2, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.get_session_for_user(pg_catalog.uuid, pg_catalog.uuid) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.complete_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION burger_boost.transition_session(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) TO service_role;

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

  -- 3. Only tables, the sequence, and PK/UNIQUE-backed indexes.
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

  -- 4. Zero policies, user triggers, FKs; exactly the 4 approved RPCs.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p2
             JOIN pg_catalog.pg_class c ON c.oid = p2.polrelid
             WHERE c.relnamespace = ns) THEN
    RAISE EXCEPTION 'BB postflight: policies present';
  END IF;
  -- STEP 04F: exactly 4 functions, all owner-owned SECURITY DEFINER with
  -- the fixed search_path; explicit ACL = owner + service_role EXECUTE.
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = ns) <> 4
     OR (SELECT count(*) FROM pg_catalog.pg_proc
         WHERE pronamespace = ns
           AND proname IN ('create_session','get_session_for_user','complete_session','transition_session')
           AND proowner = own AND prosecdef AND prokind = 'f'
           AND proconfig = ARRAY['search_path=pg_catalog, burger_boost, pg_temp']) <> 4 THEN
    RAISE EXCEPTION 'BB postflight: function set/owner/definer/search_path mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc f
             WHERE f.pronamespace = ns AND f.proacl IS NULL)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc f
       CROSS JOIN LATERAL pg_catalog.aclexplode(f.proacl) a
       WHERE f.pronamespace = ns
         AND a.grantee <> own
         AND NOT (a.grantee = svc AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable)) THEN
    RAISE EXCEPTION 'BB postflight: unapproved function ACL entry';
  END IF;
  FOR rel IN SELECT oid, proname FROM pg_catalog.pg_proc WHERE pronamespace = ns LOOP
    IF NOT pg_catalog.has_function_privilege(svc, rel.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'BB postflight: service_role lacks EXECUTE on %', rel.proname;
    END IF;
    FOR cr IN SELECT oid, rolname FROM pg_catalog.pg_roles
              WHERE rolname IN ('anon','authenticated','authenticator') LOOP
      IF pg_catalog.has_function_privilege(cr.oid, rel.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'BB postflight: % has EXECUTE on %', cr.rolname, rel.proname;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
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

    -- STEP 22K-I: authenticator is no longer exempt. It is a login role
    -- that must reach data only via SET ROLE anon/authenticated, so it
    -- must hold zero effective table/sequence privileges itself.
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
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'BB postflight: expected client roles anon/authenticated missing';
  END IF;

  -- 8. STEP 22K-H: independent owner-membership re-verification.
  --    ADMIN OPTION is read directly from pg_auth_members because
  --    pg_has_role(..., 'SET'|'USAGE') does not evaluate it.
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.roleid = own) <> 2 THEN
    RAISE EXCEPTION 'BB postflight: owner membership row count is not exactly 2';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.grantor
    WHERE m.roleid = own AND mb.rolname = 'postgres' AND gr.rolname = 'supabase_admin'
      AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
  ) THEN
    RAISE EXCEPTION 'BB postflight: membership M-1 missing or flags changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
    JOIN pg_catalog.pg_roles gr ON gr.oid = m.grantor
    WHERE m.roleid = own AND mb.rolname = 'postgres' AND gr.rolname = 'postgres'
      AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option
  ) THEN
    RAISE EXCEPTION 'BB postflight: membership M-2 missing or flags changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = own) THEN
    RAISE EXCEPTION 'BB postflight: burger_boost_owner became a member of another role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles o
             WHERE o.oid = own
               AND (o.rolcanlogin OR o.rolsuper OR o.rolcreatedb OR o.rolcreaterole
                    OR o.rolreplication OR o.rolbypassrls)) THEN
    RAISE EXCEPTION 'BB postflight: burger_boost_owner attributes no longer restrictive';
  END IF;
  -- STEP 22K-I: supabase_admin must exist AND be superuser (evidence-dependent).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                 WHERE rolname = 'supabase_admin' AND rolsuper) THEN
    RAISE EXCEPTION 'BB postflight: supabase_admin absent or not superuser';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolsuper AND rolname <> 'supabase_admin') THEN
    RAISE EXCEPTION 'BB postflight: unexpected superuser role present';
  END IF;

  -- STEP 22K-I: exact observed postgres -> service_role membership (S-1).
  IF (SELECT count(*) FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
      JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
      WHERE mb.rolname = 'postgres' AND gr.rolname = 'service_role') <> 1
     OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      JOIN pg_catalog.pg_roles mb ON mb.oid = m.member
      JOIN pg_catalog.pg_roles gr ON gr.oid = m.roleid
      JOIN pg_catalog.pg_roles gt ON gt.oid = m.grantor
      WHERE mb.rolname = 'postgres' AND gr.rolname = 'service_role'
        AND gt.rolname = 'supabase_admin'
        AND m.admin_option AND m.inherit_option AND m.set_option) THEN
    RAISE EXCEPTION 'BB postflight: postgres->service_role membership S-1 missing, duplicated or changed';
  END IF;

  -- 9. All-role effective SET/USAGE sweep against the owner (every row
  --    of pg_roles, incl. custom and platform roles). Only exceptions:
  --    the owner itself, supabase_admin (superuser, evidence-dependent),
  --    and postgres (SET only; asserted separately below).
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles c
    WHERE c.oid <> own
      AND c.rolname NOT IN ('postgres','supabase_admin')
      AND (pg_catalog.pg_has_role(c.oid, own, 'USAGE')
           OR pg_catalog.pg_has_role(c.oid, own, 'SET'))
  ) THEN
    RAISE EXCEPTION 'BB postflight: unapproved role can assume/inherit burger_boost_owner';
  END IF;
  IF NOT pg_catalog.pg_has_role('postgres', own, 'SET') THEN
    RAISE EXCEPTION 'BB postflight: postgres lost SET access to burger_boost_owner';
  END IF;
  IF pg_catalog.pg_has_role('postgres', own, 'USAGE') THEN
    RAISE EXCEPTION 'BB postflight: postgres inherits burger_boost_owner';
  END IF;
  FOR cr IN SELECT oid, rolname FROM pg_catalog.pg_roles
            WHERE rolname IN ('service_role','anon','authenticated')
  LOOP
    IF pg_catalog.pg_has_role(cr.oid, own, 'SET')
       OR pg_catalog.pg_has_role(cr.oid, own, 'USAGE') THEN
      RAISE EXCEPTION 'BB postflight: % has SET/USAGE path to burger_boost_owner', cr.rolname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname = 'service_role') <> 1 THEN
    RAISE EXCEPTION 'BB postflight: service_role missing';
  END IF;
END
$postflight$;

RESET ROLE;
COMMIT;

-- No rollback block is included here; any rollback requires a separate,
-- reviewed, dependency-checked plan. DROP ... CASCADE is not permitted.
-- =====================================================================
