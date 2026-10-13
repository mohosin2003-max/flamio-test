CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view suppliers"
ON public.suppliers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE TRIGGER update_suppliers_updated_at
BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.riders TO authenticated;
GRANT ALL ON public.riders TO service_role;

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view riders"
ON public.riders FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE TRIGGER update_riders_updated_at
BEFORE UPDATE ON public.riders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orders
  ADD COLUMN rider_id uuid REFERENCES public.riders(id) ON DELETE SET NULL;

CREATE TABLE public.payment_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'sandbox',
  merchant_reference text,
  note text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_providers IS 'Non-secret payment provider configuration only. API keys/secrets are never stored here; they live in the server secret store.';

GRANT SELECT ON public.payment_providers TO authenticated;
GRANT ALL ON public.payment_providers TO service_role;

ALTER TABLE public.payment_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view payment providers"
ON public.payment_providers FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'owner')
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
);

CREATE TRIGGER update_payment_providers_updated_at
BEFORE UPDATE ON public.payment_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.payment_providers (slug, label, is_enabled, mode, sort_order)
VALUES
  ('cash', 'Cash', true, 'live', 0),
  ('bkash', 'bKash', false, 'sandbox', 1),
  ('nagad', 'Nagad', false, 'sandbox', 2),
  ('card', 'Card / Online Payment', false, 'sandbox', 3);

ALTER TABLE public.promo_banners
  ADD COLUMN IF NOT EXISTS desktop_image_path text,
  ADD COLUMN IF NOT EXISTS mobile_image_path text;

ALTER TABLE public.promo_banners
  ALTER COLUMN title SET DEFAULT 'Promotional banner';

CREATE POLICY "Owners can upload banner images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'banner-images'
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

CREATE POLICY "Owners can update banner images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'banner-images'
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
)
WITH CHECK (
  bucket_id = 'banner-images'
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

CREATE POLICY "Owners can delete banner images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'banner-images'
  AND (
    public.has_role(auth.uid(), 'owner'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
);

CREATE TABLE public.staff_permissions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, permission)
);

GRANT SELECT ON public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_permissions TO service_role;

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own permissions"
ON public.staff_permissions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_staff_permissions_updated_at
BEFORE UPDATE ON public.staff_permissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

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

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

CREATE TABLE public.reward_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_]+$'),
  name text NOT NULL,
  description text,
  points integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  is_enabled boolean NOT NULL DEFAULT true,
  requires_claim boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reward_rules TO authenticated;
GRANT ALL ON public.reward_rules TO service_role;
ALTER TABLE public.reward_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view reward rules" ON public.reward_rules FOR SELECT TO authenticated USING (true);

CREATE TABLE public.reward_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.reward_rules(id) ON DELETE SET NULL,
  action_key text NOT NULL,
  reference_id text NOT NULL,
  points integer NOT NULL CHECK (points <> 0),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, action_key, reference_id)
);
GRANT SELECT ON public.reward_transactions TO authenticated;
GRANT ALL ON public.reward_transactions TO service_role;
ALTER TABLE public.reward_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers can view their reward history" ON public.reward_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES public.reward_rules(id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (char_length(reference) BETWEEN 3 AND 240),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 500),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reward_claims_unique_reference ON public.reward_claims (user_id, rule_id, lower(reference));
GRANT SELECT, INSERT ON public.reward_claims TO authenticated;
GRANT ALL ON public.reward_claims TO service_role;
ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers can view their reward claims" ON public.reward_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Customers can submit reward claims" ON public.reward_claims FOR INSERT TO authenticated WITH CHECK (
  auth.uid() = user_id AND status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL
  AND EXISTS (SELECT 1 FROM public.reward_rules r WHERE r.id = rule_id AND r.is_enabled AND r.requires_claim)
);

CREATE TRIGGER update_reward_rules_updated_at BEFORE UPDATE ON public.reward_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_reward_claims_updated_at BEFORE UPDATE ON public.reward_claims FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.reward_rules (slug, name, description, points, is_enabled, requires_claim, sort_order) VALUES
  ('completed_order', 'Completed order', 'Earn points after an order is completed.', 10, true, false, 0),
  ('referral', 'Referral', 'Refer a new Flamio customer for owner review.', 50, true, true, 1),
  ('brand_promotion', 'Brand promotion', 'Share eligible Flamio content for owner review.', 25, true, true, 2),
  ('review', 'Customer review', 'Submit an eligible review for owner verification.', 20, true, true, 3),
  ('challenge', 'Flamio challenge', 'Complete an active Flamio challenge.', 30, false, true, 4)
ON CONFLICT (slug) DO NOTHING;

CREATE OR REPLACE FUNCTION public.award_completed_order_reward()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.reward_rules%ROWTYPE;
BEGIN
  IF NEW.user_id IS NULL OR NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rule FROM public.reward_rules WHERE slug = 'completed_order' AND is_enabled LIMIT 1;
  IF FOUND AND v_rule.points > 0 THEN
    INSERT INTO public.reward_transactions (user_id, rule_id, action_key, reference_id, points, description)
    VALUES (NEW.user_id, v_rule.id, v_rule.slug, NEW.id::text, v_rule.points, 'Completed order ' || NEW.code)
    ON CONFLICT (user_id, action_key, reference_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER award_completed_order_reward_after_insert AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.award_completed_order_reward();
CREATE TRIGGER award_completed_order_reward_after_update AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.award_completed_order_reward();

CREATE POLICY "Customers can upload their profile photo" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Customers can view their profile photo" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Customers can update their profile photo" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text) WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Customers can delete their profile photo" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

REVOKE ALL ON FUNCTION public.award_completed_order_reward() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_completed_order_reward() TO service_role;