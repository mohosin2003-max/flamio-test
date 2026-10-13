-- =============================================================================
-- Flamio — Owner Finance & Profit Partners
-- Run once in Supabase → SQL Editor.
--
-- ADDITIVE ONLY. This file contains no DROP, TRUNCATE, DELETE, UPDATE or
-- destructive ALTER. No existing table, column, policy, grant, function,
-- trigger or row is changed or removed. Existing salary, payroll,
-- money-taken, purchase and order records are untouched, and none of the
-- tables below participate in the existing business-profit calculation
-- (completed-order revenue minus purchases), which stays exactly as it is.
--
-- Depends on objects that already exist in this database:
--   auth.users              (owner / staff identities)
--   public.has_role(uuid, public.app_role)   (security-definer role check)
-- Reads only, never modified: public.orders, public.purchases,
--   public.profiles, public.staff_salary_profiles, public.staff_ledger_entries.
--
-- No database functions or triggers are required: all writes go through
-- owner-only server functions using the service role, and all figures
-- (earned / paid / remaining / retained) are derived at read time from the
-- effective-dated rows below, so there is nothing to keep in sync.
-- =============================================================================

-- =============================================================================
-- 1. OWNER PROFIT WITHDRAWALS
--    Money the owner takes out of business profit. Deliberately separate from
--    staff salary, staff advances, staff money-taken and business purchases,
--    so it can never behave as an operating expense.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.owner_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  entry_time time,
  period_month text NOT NULL CHECK (period_month ~ '^\d{4}-\d{2}$'),
  reason text NOT NULL,
  note text,
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','mobile')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_withdrawals_date_idx ON public.owner_withdrawals (entry_date DESC);
CREATE INDEX IF NOT EXISTS owner_withdrawals_month_idx ON public.owner_withdrawals (period_month);

GRANT SELECT ON public.owner_withdrawals TO authenticated;
GRANT ALL ON public.owner_withdrawals TO service_role;
ALTER TABLE public.owner_withdrawals ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. PROFIT PARTNER TERMS (effective dated, append-only history)
--    One row = one period at one percentage. Changing the percentage closes
--    the current row and inserts a new one, so historical months keep the
--    percentage they were earned under. Active partner = a row with
--    effective_to IS NULL. Disabled partner = effective_to set; history stays.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profit_partner_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_percent numeric(5,2) NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
  effective_from date NOT NULL,
  effective_to date,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profit_partner_terms_period_valid
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS profit_partner_terms_user_idx
  ON public.profit_partner_terms (user_id, effective_from);

-- At most one open (active) period per partner.
CREATE UNIQUE INDEX IF NOT EXISTS profit_partner_terms_one_open_idx
  ON public.profit_partner_terms (user_id)
  WHERE effective_to IS NULL;

GRANT SELECT ON public.profit_partner_terms TO authenticated;
GRANT ALL ON public.profit_partner_terms TO service_role;
ALTER TABLE public.profit_partner_terms ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. PARTNER PROFIT-SHARE PAYMENTS
--    Reduces what the partner is still owed; never changes what was earned.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.partner_profit_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on date NOT NULL DEFAULT CURRENT_DATE,
  period_month text CHECK (period_month IS NULL OR period_month ~ '^\d{4}-\d{2}$'),
  payment_method text CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','mobile')),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_profit_payments_user_idx
  ON public.partner_profit_payments (user_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS partner_profit_payments_month_idx
  ON public.partner_profit_payments (period_month);

GRANT SELECT ON public.partner_profit_payments TO authenticated;
GRANT ALL ON public.partner_profit_payments TO service_role;
ALTER TABLE public.partner_profit_payments ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. ROW LEVEL SECURITY (created only when missing — existing policies kept)
--    Owner/admin: read everything. Partner: own rows only, and never owner
--    withdrawals. Plain staff and anon: nothing. All writes happen through the
--    service role inside owner-only server functions, so no INSERT/UPDATE/
--    DELETE policy is granted to any logged-in role.
-- =============================================================================

DO $$
BEGIN
  -- Owner withdrawals: owner/admin read only. Partners and staff get no policy.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'owner_withdrawals' AND policyname = 'Managers read owner withdrawals') THEN
    CREATE POLICY "Managers read owner withdrawals" ON public.owner_withdrawals
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'owner'::public.app_role)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      );
  END IF;

  -- Partner terms.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'profit_partner_terms' AND policyname = 'Managers read partner terms') THEN
    CREATE POLICY "Managers read partner terms" ON public.profit_partner_terms
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'owner'::public.app_role)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'profit_partner_terms' AND policyname = 'Partners read their own terms') THEN
    CREATE POLICY "Partners read their own terms" ON public.profit_partner_terms
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;

  -- Partner payments.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'partner_profit_payments' AND policyname = 'Managers read partner payments') THEN
    CREATE POLICY "Managers read partner payments" ON public.partner_profit_payments
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(), 'owner'::public.app_role)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
    AND tablename = 'partner_profit_payments' AND policyname = 'Partners read their own payments') THEN
    CREATE POLICY "Partners read their own payments" ON public.partner_profit_payments
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- =============================================================================
-- End of migration. No seed, demo or test rows. No secrets. No app code.
-- =============================================================================
