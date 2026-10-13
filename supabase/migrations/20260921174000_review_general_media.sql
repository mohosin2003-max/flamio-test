ALTER TABLE public.order_reviews
  ALTER COLUMN order_id DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS video_path text;

ALTER TABLE public.order_reviews
  DROP CONSTRAINT IF EXISTS order_reviews_order_id_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS order_reviews_order_user_unique
ON public.order_reviews (order_id, user_id)
WHERE order_id IS NOT NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_reviews_status_created_idx
ON public.order_reviews (status, created_at DESC);

CREATE INDEX IF NOT EXISTS order_reviews_guest_status_idx
ON public.order_reviews (status)
WHERE order_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_reviews_order_or_general_check'
      AND conrelid = 'public.order_reviews'::regclass
  ) THEN
    ALTER TABLE public.order_reviews
      ADD CONSTRAINT order_reviews_order_or_general_check
      CHECK (
        (order_id IS NOT NULL AND user_id IS NOT NULL)
        OR (order_id IS NULL AND (user_id IS NOT NULL OR nullif(trim(guest_name), '') IS NOT NULL))
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_reviews TO authenticated;
GRANT ALL ON public.order_reviews TO service_role;

DROP POLICY IF EXISTS "Customers can review their own completed orders" ON public.order_reviews;
DROP POLICY IF EXISTS "Customers can review completed orders or general visits" ON public.order_reviews;

CREATE POLICY "Customers can review completed orders or general visits"
ON public.order_reviews FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (photo_path IS NULL OR photo_path LIKE auth.uid()::text || '/%')
  AND (video_path IS NULL OR video_path LIKE auth.uid()::text || '/%')
  AND (
    order_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_reviews.order_id
        AND o.user_id = auth.uid()
        AND o.status = 'completed'
    )
  )
);
