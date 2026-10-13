-- =============================================================================
-- Flamio — ADD-ONLY schema top-up for external Supabase project
-- Target project: psckjmopvxaqvroaltfu   (https://psckjmopvxaqvroaltfu.supabase.co)
-- Run this ONCE in that project's SQL Editor (upload as a file, do not paste).
--
-- SAFETY GUARANTEES
--   * Contains NO DROP, NO TRUNCATE, NO DELETE, NO UPDATE, NO INSERT.
--   * Every object is created with IF NOT EXISTS / guarded DO blocks,
--     so existing tables, columns, rows, policies and buckets are untouched.
--   * Re-running it is safe (idempotent).
--   * Touches only the public schema of the project you run it in.
-- =============================================================================

-- 0. Prerequisite check ------------------------------------------------------
-- These must already exist from the earlier schema file:
--   public.products, public.orders, public.user_roles, public.has_role(uuid, app_role),
--   public.update_updated_at_column()
DO $$
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Base schema missing: run supabase-external-schema.sql first.';
  END IF;
END $$;

-- Safety net: recreate the shared helpers only if absent (never overwrites).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
      LANGUAGE plpgsql SET search_path = public AS $body$
      BEGIN NEW.updated_at = now(); RETURN NEW; END; $body$;
    $fn$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'has_role'
  ) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
        SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
      $body$;
    $fn$;
  END IF;
END $$;

-- =============================================================================
-- 1. STAFF ACCOUNTS & FINANCIAL LEDGER
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_salary_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  pay_type text NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('monthly','daily')),
  monthly_rate numeric NOT NULL DEFAULT 0,
  daily_rate numeric NOT NULL DEFAULT 0,
  overtime_hourly_rate numeric NOT NULL DEFAULT 0,
  payday integer NOT NULL DEFAULT 1 CHECK (payday >= 1 AND payday <= 31),
  starts_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN (
    'salary_payment','salary_advance','personal_advance','advance',
    'loan','loan_repayment','bonus','deduction','overtime','other')),
  amount numeric NOT NULL CHECK (amount >= 0),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','mobile')),
  note text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_ledger_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('create','update','delete')),
  before_data jsonb,
  after_data jsonb,
  reason text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_ledger_entries_user_idx  ON public.staff_ledger_entries (user_id);
CREATE INDEX IF NOT EXISTS staff_ledger_entries_date_idx  ON public.staff_ledger_entries (entry_date DESC);
CREATE INDEX IF NOT EXISTS staff_ledger_audit_entry_idx   ON public.staff_ledger_audit (entry_id);
CREATE INDEX IF NOT EXISTS staff_ledger_audit_user_idx    ON public.staff_ledger_audit (user_id, created_at DESC);

GRANT SELECT ON public.staff_salary_profiles TO authenticated;
GRANT SELECT ON public.staff_ledger_entries  TO authenticated;
GRANT SELECT ON public.staff_ledger_audit    TO authenticated;
GRANT ALL ON public.staff_salary_profiles TO service_role;
GRANT ALL ON public.staff_ledger_entries  TO service_role;
GRANT ALL ON public.staff_ledger_audit    TO service_role;

ALTER TABLE public.staff_salary_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_ledger_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_ledger_audit    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='staff_salary_profiles' AND policyname='Users can view their own salary profile') THEN
    CREATE POLICY "Users can view their own salary profile" ON public.staff_salary_profiles
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='staff_ledger_entries' AND policyname='Users can view their own ledger entries') THEN
    CREATE POLICY "Users can view their own ledger entries" ON public.staff_ledger_entries
      FOR SELECT TO authenticated USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='staff_ledger_audit' AND policyname='Managers read staff ledger audit') THEN
    CREATE POLICY "Managers read staff ledger audit" ON public.staff_ledger_audit
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_staff_salary_profiles_updated_at') THEN
    CREATE TRIGGER update_staff_salary_profiles_updated_at BEFORE UPDATE ON public.staff_salary_profiles
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_staff_ledger_entries_updated_at') THEN
    CREATE TRIGGER update_staff_ledger_entries_updated_at BEFORE UPDATE ON public.staff_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- =============================================================================
-- 2. ONLINE SALES PLATFORMS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sales_platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  commission_percent numeric NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  pricing_mode text NOT NULL DEFAULT 'normal' CHECK (pricing_mode IN ('normal','custom')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_platforms_name_unique ON public.sales_platforms (lower(name));

CREATE TABLE IF NOT EXISTS public.platform_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES public.sales_platforms(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_id, product_id)
);

CREATE INDEX IF NOT EXISTS platform_product_prices_platform_idx ON public.platform_product_prices (platform_id);

GRANT SELECT ON public.sales_platforms TO authenticated;
GRANT SELECT ON public.platform_product_prices TO authenticated;
GRANT ALL ON public.sales_platforms TO service_role;
GRANT ALL ON public.platform_product_prices TO service_role;

ALTER TABLE public.sales_platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_product_prices ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='sales_platforms' AND policyname='Managers read sales platforms') THEN
    CREATE POLICY "Managers read sales platforms" ON public.sales_platforms
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='platform_product_prices' AND policyname='Managers read platform prices') THEN
    CREATE POLICY "Managers read platform prices" ON public.platform_product_prices
      FOR SELECT TO authenticated
      USING (public.has_role(auth.uid(),'owner') OR public.has_role(auth.uid(),'admin'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_sales_platforms_updated_at') THEN
    CREATE TRIGGER update_sales_platforms_updated_at BEFORE UPDATE ON public.sales_platforms
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_platform_product_prices_updated_at') THEN
    CREATE TRIGGER update_platform_product_prices_updated_at BEFORE UPDATE ON public.platform_product_prices
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- =============================================================================
-- 3. ORDERS: platform sale snapshot columns (added only if missing)
-- =============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_id uuid REFERENCES public.sales_platforms(id) ON DELETE SET NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS platform_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS commission_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS net_receivable numeric;

-- =============================================================================
-- 4. Verification (read-only) — run after the script to confirm
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name IN
--  ('staff_salary_profiles','staff_ledger_entries','staff_ledger_audit',
--   'sales_platforms','platform_product_prices');
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='orders'
--    AND column_name IN ('platform_id','platform_name','commission_rate','commission_amount','net_receivable');
