ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS opens_at text,
  ADD COLUMN IF NOT EXISTS closes_at text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS google_maps_url text;