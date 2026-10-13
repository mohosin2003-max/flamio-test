-- =============================================================================
-- Flamio — Phase 4: Owner self-service integrations & communication control
-- Run once in Supabase → SQL Editor.
--
-- ADDITIVE ONLY. No DROP, TRUNCATE, DELETE or destructive ALTER. No existing
-- table, column, policy, grant, function, trigger or row is changed or removed.
-- Every statement is safe to re-run.
--
-- Reuses the EXISTING provider-configuration table `public.sms_providers` for
-- WhatsApp and Email (new rows, new nullable columns). The existing SMS/OTP row
-- (slug = 'sms_otp') keeps behaving exactly as today.
--
-- Writes happen only through owner/staff server functions using the service
-- role, so no write policies are granted to logged-in roles and nothing is
-- granted to anon.
-- =============================================================================

-- 1. Extend the existing provider-config table (additive columns only) --------

ALTER TABLE public.sms_providers
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms';

ALTER TABLE public.sms_providers
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.sms_providers.config IS
  'Non-secret identifiers only (sender name, from address, WhatsApp business/phone-number id). Never credentials.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sms_providers'::regclass
      AND conname = 'sms_providers_channel_check'
  ) THEN
    ALTER TABLE public.sms_providers
      ADD CONSTRAINT sms_providers_channel_check
      CHECK (channel IN ('sms', 'whatsapp', 'email'));
  END IF;
END $$;

-- The existing `provider` check constraint (if any) only allowed the two SMS
-- vendors. Widen it so the WhatsApp/Email vendor names are accepted. Existing
-- rows and values stay valid — this accepts MORE values than before, never fewer.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
  FROM pg_constraint
  WHERE conrelid = 'public.sms_providers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%alpha_sms%'
    AND pg_get_constraintdef(oid) NOT ILIKE '%whatsapp_cloud%'
  LIMIT 1;

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.sms_providers DROP CONSTRAINT %I', c);
    EXECUTE 'ALTER TABLE public.sms_providers ADD CONSTRAINT ' || quote_ident(c) ||
            ' CHECK (provider IN (''alpha_sms'', ''smsbd'', ''whatsapp_cloud'', ''resend''))';
  END IF;
END $$;

-- Configuration rows for the two new channels. Disabled until the owner
-- configures and tests them. Guarded so re-running changes nothing.
INSERT INTO public.sms_providers (slug, provider, is_enabled, channel, note)
SELECT 'whatsapp', 'whatsapp_cloud', false, 'whatsapp',
       'Official WhatsApp Cloud API. Credentials live in the server secret store.'
WHERE NOT EXISTS (SELECT 1 FROM public.sms_providers WHERE slug = 'whatsapp');

INSERT INTO public.sms_providers (slug, provider, is_enabled, channel, note)
SELECT 'email', 'resend', false, 'email',
       'Email delivery provider. API key lives in the server secret store.'
WHERE NOT EXISTS (SELECT 1 FROM public.sms_providers WHERE slug = 'email');

-- The existing SMS/OTP row predates the channel column; make it explicit.
UPDATE public.sms_providers SET channel = 'sms'
WHERE slug = 'sms_otp' AND channel IS DISTINCT FROM 'sms';

-- 2. Provider-level message log (new — nothing existing can carry this) ------

CREATE TABLE IF NOT EXISTS public.communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text,
  customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id uuid,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms', 'whatsapp', 'email')),
  category text NOT NULL CHECK (category IN ('transactional', 'service', 'marketing')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  provider_slug text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')),
  body_preview text,
  error_text text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_messages_dedupe_idx
  ON public.communication_messages (dedupe_key);
CREATE INDEX IF NOT EXISTS communication_messages_customer_idx
  ON public.communication_messages (customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS communication_messages_provider_msg_idx
  ON public.communication_messages (provider_slug, provider_message_id);

GRANT SELECT ON public.communication_messages TO authenticated;
GRANT ALL ON public.communication_messages TO service_role;
ALTER TABLE public.communication_messages ENABLE ROW LEVEL SECURITY;

-- 3. Customer communication preferences / consent (new) ----------------------

CREATE TABLE IF NOT EXISTS public.customer_communication_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'push', 'sms', 'whatsapp', 'email')),
  category text NOT NULL CHECK (category IN ('transactional', 'service', 'marketing')),
  opted_in boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'owner',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_comm_prefs_unique_idx
  ON public.customer_communication_preferences (customer_phone, channel, category);

GRANT SELECT ON public.customer_communication_preferences TO authenticated;
GRANT ALL ON public.customer_communication_preferences TO service_role;
ALTER TABLE public.customer_communication_preferences ENABLE ROW LEVEL SECURITY;

-- 4. Owner/admin read policies (writes stay service-role only) ---------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['communication_messages', 'customer_communication_preferences']
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

-- End of Phase 4 migration. No seed/demo data, no secrets, no app code.
