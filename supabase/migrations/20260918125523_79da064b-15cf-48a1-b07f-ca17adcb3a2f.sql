CREATE TABLE public.staff_salary_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  pay_type text NOT NULL DEFAULT 'monthly',
  monthly_rate numeric(12,2) NOT NULL DEFAULT 0,
  daily_rate numeric(12,2) NOT NULL DEFAULT 0,
  overtime_hourly_rate numeric(12,2) NOT NULL DEFAULT 0,
  payday integer NOT NULL DEFAULT 1,
  starts_on date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_salary_profiles_pay_type_check CHECK (pay_type IN ('monthly','daily')),
  CONSTRAINT staff_salary_profiles_payday_check CHECK (payday BETWEEN 1 AND 31)
);

GRANT SELECT ON public.staff_salary_profiles TO authenticated;
GRANT ALL ON public.staff_salary_profiles TO service_role;
ALTER TABLE public.staff_salary_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own salary profile"
  ON public.staff_salary_profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_staff_salary_profiles_updated_at
  BEFORE UPDATE ON public.staff_salary_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.staff_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  amount numeric(12,2) NOT NULL,
  entry_date date NOT NULL DEFAULT current_date,
  payment_method text,
  note text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_ledger_entries_type_check CHECK (entry_type IN ('salary_payment','advance','loan','loan_repayment','bonus','deduction','overtime','other')),
  CONSTRAINT staff_ledger_entries_amount_check CHECK (amount >= 0),
  CONSTRAINT staff_ledger_entries_method_check CHECK (payment_method IS NULL OR payment_method IN ('cash','bank','mobile'))
);

GRANT SELECT ON public.staff_ledger_entries TO authenticated;
GRANT ALL ON public.staff_ledger_entries TO service_role;
ALTER TABLE public.staff_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own ledger entries"
  ON public.staff_ledger_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX staff_ledger_entries_user_idx ON public.staff_ledger_entries (user_id);
CREATE INDEX staff_ledger_entries_date_idx ON public.staff_ledger_entries (entry_date DESC);

CREATE TRIGGER update_staff_ledger_entries_updated_at
  BEFORE UPDATE ON public.staff_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();