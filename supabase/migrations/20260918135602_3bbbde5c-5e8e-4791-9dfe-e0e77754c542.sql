ALTER TABLE public.staff_ledger_entries DROP CONSTRAINT staff_ledger_entries_type_check;
ALTER TABLE public.staff_ledger_entries ADD CONSTRAINT staff_ledger_entries_type_check CHECK (entry_type = ANY (ARRAY['salary_payment','salary_advance','personal_advance','advance','loan','loan_repayment','bonus','deduction','overtime','other']));

ALTER TABLE public.staff_ledger_entries ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.staff_ledger_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action = ANY (ARRAY['create','update','delete'])),
  before_data jsonb,
  after_data jsonb,
  reason text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_ledger_audit_entry_idx ON public.staff_ledger_audit (entry_id);
CREATE INDEX IF NOT EXISTS staff_ledger_audit_user_idx ON public.staff_ledger_audit (user_id, created_at DESC);

GRANT SELECT ON public.staff_ledger_audit TO authenticated;
GRANT ALL ON public.staff_ledger_audit TO service_role;

ALTER TABLE public.staff_ledger_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers read staff ledger audit" ON public.staff_ledger_audit
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));