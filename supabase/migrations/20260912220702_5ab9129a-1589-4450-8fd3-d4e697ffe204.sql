CREATE TABLE public.payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'sandbox',
  merchant_reference text,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_providers IS 'Non-secret payment provider configuration only. API keys/secrets are never stored here; they live in the server secret store.';

GRANT SELECT ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view payment providers"
ON public.payment_providers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE TRIGGER update_payment_providers_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.payment_providers (slug, label, is_enabled, mode, sort_order)
VALUES
  ('cash', 'Cash', true, 'live', 0),
  ('bkash', 'bKash', false, 'sandbox', 1),
  ('nagad', 'Nagad', false, 'sandbox', 2),
  ('card', 'Card / Online Payment', false, 'sandbox', 3);