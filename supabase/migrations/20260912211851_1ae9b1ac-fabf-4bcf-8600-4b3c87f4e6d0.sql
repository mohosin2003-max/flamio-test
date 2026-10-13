CREATE TABLE public.delivery_zones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  delivery_charge numeric NOT NULL DEFAULT 0,
  minimum_order numeric NOT NULL DEFAULT 0,
  free_delivery_threshold numeric,
  is_free_delivery_enabled boolean NOT NULL DEFAULT true,
  estimated_delivery_time text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.delivery_zones TO anon, authenticated;
GRANT ALL ON public.delivery_zones TO service_role;

ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Delivery zones are publicly readable"
ON public.delivery_zones
FOR SELECT
TO anon, authenticated
USING (true);

CREATE TRIGGER update_delivery_zones_updated_at
BEFORE UPDATE ON public.delivery_zones
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.delivery_zones
  (slug, name, delivery_charge, minimum_order, free_delivery_threshold, is_free_delivery_enabled, estimated_delivery_time, is_active, sort_order)
VALUES
  ('kishoreganj_sadar', 'Kishoreganj Sadar', 50, 0, 500, true, '30–45 min', true, 0);