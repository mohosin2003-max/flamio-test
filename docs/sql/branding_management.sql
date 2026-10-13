ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS brand_primary_logo_path text
    CONSTRAINT restaurant_settings_brand_primary_logo_path_check
    CHECK (
      brand_primary_logo_path IS NULL
      OR brand_primary_logo_path ~ '^brand/primary/[0-9]{10,}-[0-9a-f-]+\.webp$'
    );

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS brand_icon_logo_path text
    CONSTRAINT restaurant_settings_brand_icon_logo_path_check
    CHECK (
      brand_icon_logo_path IS NULL
      OR brand_icon_logo_path ~ '^brand/icon/[0-9]{10,}-[0-9a-f-]+\.webp$'
    );

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS brand_version integer NOT NULL DEFAULT 1
    CONSTRAINT restaurant_settings_brand_version_positive_check
    CHECK (brand_version >= 1);

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS brand_updated_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS brand_updated_at timestamp with time zone;
