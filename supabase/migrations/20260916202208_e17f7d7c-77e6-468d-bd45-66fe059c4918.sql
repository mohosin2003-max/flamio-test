ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS recommendations_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS recommendations_count integer NOT NULL DEFAULT 6;