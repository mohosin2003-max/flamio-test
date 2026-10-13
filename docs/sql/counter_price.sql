-- Additive: optional persistent Counter Sale price per product. NULL = use base_price.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS counter_price numeric NULL CHECK (counter_price IS NULL OR counter_price >= 0);
