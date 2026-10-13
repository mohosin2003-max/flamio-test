-- Flamio — Customer CRM, Phase 1
-- Run once in Supabase → SQL Editor.
--
-- ADDITIVE ONLY. No DROP, TRUNCATE, DELETE, UPDATE or destructive ALTER.
-- No existing table, column, policy, grant, function, trigger or row is
-- changed or removed. Every statement is safe to re-run.
--
-- Writes happen only through owner/staff server functions using the service
-- role, so no write policies are granted to logged-in roles, and nothing at
-- all is granted to anon.

-- 1. One record per recognised customer (derived from existing order history).
CREATE TABLE IF NOT EXISTS public.crm_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL DEFAULT '',
  primary_phone text NOT NULL,
  customer_type text NOT NULL DEFAULT 'guest'
    CHECK (customer_type IN ('guest', 'account')),
  first_order_at timestamptz,
  last_order_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_customers_primary_phone_idx
  ON public.crm_customers (primary_phone);
CREATE INDEX IF NOT EXISTS crm_customers_last_order_idx
  ON public.crm_customers (last_order_at DESC);

GRANT SELECT ON public.crm_customers TO authenticated;
GRANT ALL ON public.crm_customers TO service_role;
ALTER TABLE public.crm_customers ENABLE ROW LEVEL SECURITY;

-- 2. Identities that point at a customer (phone today; auth_user / email later).
CREATE TABLE IF NOT EXISTS public.crm_customer_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_customer_id uuid NOT NULL
    REFERENCES public.crm_customers (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('auth_user', 'phone', 'email')),
  value text NOT NULL,
  verified_at timestamptz,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

CREATE INDEX IF NOT EXISTS crm_customer_identities_customer_idx
  ON public.crm_customer_identities (crm_customer_id);

GRANT SELECT ON public.crm_customer_identities TO authenticated;
GRANT ALL ON public.crm_customer_identities TO service_role;
ALTER TABLE public.crm_customer_identities ENABLE ROW LEVEL SECURITY;

-- 3. Internal notes (staff-facing only, never shown to customers).
CREATE TABLE IF NOT EXISTS public.crm_customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_customer_id uuid NOT NULL
    REFERENCES public.crm_customers (id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_customer_notes_customer_idx
  ON public.crm_customer_notes (crm_customer_id, created_at DESC);

GRANT SELECT ON public.crm_customer_notes TO authenticated;
GRANT ALL ON public.crm_customer_notes TO service_role;
ALTER TABLE public.crm_customer_notes ENABLE ROW LEVEL SECURITY;

-- 4. Tags and their links.
CREATE TABLE IF NOT EXISTS public.crm_customer_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  colour text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_customer_tags TO authenticated;
GRANT ALL ON public.crm_customer_tags TO service_role;
ALTER TABLE public.crm_customer_tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crm_customer_tag_links (
  crm_customer_id uuid NOT NULL
    REFERENCES public.crm_customers (id) ON DELETE CASCADE,
  tag_id uuid NOT NULL
    REFERENCES public.crm_customer_tags (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crm_customer_id, tag_id)
);

CREATE INDEX IF NOT EXISTS crm_customer_tag_links_tag_idx
  ON public.crm_customer_tag_links (tag_id);

GRANT SELECT ON public.crm_customer_tag_links TO authenticated;
GRANT ALL ON public.crm_customer_tag_links TO service_role;
ALTER TABLE public.crm_customer_tag_links ENABLE ROW LEVEL SECURITY;

-- 5. Access audit: who opened a profile or revealed a phone number.
CREATE TABLE IF NOT EXISTS public.crm_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_customer_id uuid,
  actor_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('view_profile', 'unmask_phone')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_access_audit_customer_idx
  ON public.crm_access_audit (crm_customer_id, created_at DESC);

GRANT SELECT ON public.crm_access_audit TO authenticated;
GRANT ALL ON public.crm_access_audit TO service_role;
ALTER TABLE public.crm_access_audit ENABLE ROW LEVEL SECURITY;

-- 6. Read policies for owners/managers only. Created only when missing.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_customers',
    'crm_customer_identities',
    'crm_customer_notes',
    'crm_customer_tags',
    'crm_customer_tag_links',
    'crm_access_audit'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'Owners read ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''owner'') OR public.has_role(auth.uid(), ''admin''))',
        'Owners read ' || t, t
      );
    END IF;
  END LOOP;
END $$;

-- End of Phase 1 migration. No seed/demo data, no secrets, no app code.
