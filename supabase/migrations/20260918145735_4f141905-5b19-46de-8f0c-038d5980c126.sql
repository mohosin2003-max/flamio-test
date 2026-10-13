CREATE TABLE public.sales_platforms (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  commission_percent numeric NOT NULL DEFAULT 0 CHECK (commission_percent >= 0 AND commission_percent <= 100),
  pricing_mode text NOT NULL DEFAULT 'normal' CHECK (pricing_mode IN ('normal','custom')),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sales_platforms_name_unique ON public.sales_platforms (lower(name));

GRANT ALL ON public.sales_platforms TO service_role;
ALTER TABLE public.sales_platforms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read sales platforms" ON public.sales_platforms
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_sales_platforms_updated_at
  BEFORE UPDATE ON public.sales_platforms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.platform_product_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform_id uuid NOT NULL REFERENCES public.sales_platforms(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price numeric NOT NULL CHECK (price >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (platform_id, product_id)
);

CREATE INDEX platform_product_prices_platform_idx ON public.platform_product_prices (platform_id);

GRANT ALL ON public.platform_product_prices TO service_role;
ALTER TABLE public.platform_product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Managers read platform prices" ON public.platform_product_prices
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_platform_product_prices_updated_at
  BEFORE UPDATE ON public.platform_product_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders
  ADD COLUMN platform_id uuid REFERENCES public.sales_platforms(id) ON DELETE SET NULL,
  ADD COLUMN platform_name text,
  ADD COLUMN commission_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN commission_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN net_receivable numeric;

CREATE INDEX orders_platform_idx ON public.orders (platform_id);