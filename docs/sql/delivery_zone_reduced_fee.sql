-- Additive: optional reduced delivery fee per delivery zone, applied when the
-- zone's existing free-delivery threshold is reached. NULL = no reduced-fee
-- rule configured; 0 = FREE delivery. Checkout pricing is NOT changed yet.
ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS reduced_delivery_fee numeric NULL
  CHECK (reduced_delivery_fee IS NULL OR reduced_delivery_fee >= 0);
