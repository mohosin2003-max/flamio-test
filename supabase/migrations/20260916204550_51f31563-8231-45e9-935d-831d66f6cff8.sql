CREATE TABLE public.order_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  photo_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'hidden')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (order_id, user_id)
);

CREATE INDEX order_reviews_product_status_idx ON public.order_reviews (product_id, status);
CREATE INDEX order_reviews_user_idx ON public.order_reviews (user_id);

GRANT SELECT, INSERT, UPDATE ON public.order_reviews TO authenticated;
GRANT ALL ON public.order_reviews TO service_role;

ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view their own reviews"
ON public.order_reviews FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Restaurant team can view all reviews"
ON public.order_reviews FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'owner') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Customers can review their own completed orders"
ON public.order_reviews FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id
      AND o.user_id = auth.uid()
      AND o.status = 'completed'
  )
);

CREATE POLICY "Customers can edit their own review"
ON public.order_reviews FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_order_reviews_updated_at
BEFORE UPDATE ON public.order_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS reviews_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_photos_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.request_order_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL OR NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE order_id = NEW.id AND status = 'review_request'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, order_id, order_code, status, title, body)
  VALUES (
    NEW.user_id,
    NEW.id,
    NEW.code,
    'review_request',
    'How was your Flamio order? ❤️',
    'Rate your experience and share your feedback.'
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.request_order_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_review() TO service_role;

CREATE TRIGGER request_order_review_after_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.request_order_review();

CREATE TRIGGER request_order_review_after_update
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.request_order_review();