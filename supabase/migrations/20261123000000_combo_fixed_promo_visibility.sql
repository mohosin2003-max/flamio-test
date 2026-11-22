-- FLAMIO Combo Step 1 — TEST ONLY (avwrptztixaketchgmsh). Additive, no data changes.
-- Fixed recipes reuse combo_groups (one product per step, min = max = quantity).
ALTER TABLE public.combos
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS show_in_offers boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_in_popular boolean NOT NULL DEFAULT false;
