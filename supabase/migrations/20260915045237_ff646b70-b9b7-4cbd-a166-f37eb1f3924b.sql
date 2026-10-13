ALTER TABLE public.orders ALTER COLUMN zone_id TYPE text USING zone_id::text;
ALTER TABLE public.customer_addresses ALTER COLUMN zone_id TYPE text USING zone_id::text;