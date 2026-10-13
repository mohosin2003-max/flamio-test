ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS zone_type text NOT NULL DEFAULT 'area',
  ADD COLUMN IF NOT EXISTS radius_min_m numeric,
  ADD COLUMN IF NOT EXISTS radius_max_m numeric;

ALTER TABLE public.delivery_zones
  DROP CONSTRAINT IF EXISTS delivery_zones_zone_type_check;
ALTER TABLE public.delivery_zones
  ADD CONSTRAINT delivery_zones_zone_type_check CHECK (zone_type IN ('area', 'radius'));

ALTER TABLE public.customer_addresses
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS distance_m numeric;