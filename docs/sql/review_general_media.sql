-- Flamio customer reviews — FINAL.
--
-- Signed-in customers only (no guest/anonymous reviews).
-- Written review + star rating + OPTIONAL PHOTO. No video anywhere:
-- no video column, no video storage, no video policy.
--
-- Run this in the external Supabase project's SQL Editor. Existing
-- order-linked reviews, their photos and their moderation status are preserved.
--
-- NOTE: supabase/migrations/20260921174000_review_general_media.sql is an old
-- draft (guest + video support) and must NOT be used. This file is the only
-- SQL to apply.

-- 1. General (order-less) reviews need order_id to be optional.
ALTER TABLE public.order_reviews
  ALTER COLUMN order_id DROP NOT NULL;

-- 2. Remove anything an earlier draft may have added.
ALTER TABLE public.order_reviews
  DROP COLUMN IF EXISTS guest_name,
  DROP COLUMN IF EXISTS video_path;

ALTER TABLE public.order_reviews
  DROP CONSTRAINT IF EXISTS order_reviews_order_id_user_id_key,
  DROP CONSTRAINT IF EXISTS order_reviews_order_or_general_check;

DROP INDEX IF EXISTS public.order_reviews_guest_status_idx;

-- 3. One review per (order, customer) — only for order-linked reviews.
CREATE UNIQUE INDEX IF NOT EXISTS order_reviews_order_user_unique
ON public.order_reviews (order_id, user_id)
WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_reviews_status_created_idx
ON public.order_reviews (status, created_at DESC);

CREATE INDEX IF NOT EXISTS order_reviews_general_status_idx
ON public.order_reviews (status)
WHERE order_id IS NULL;

-- 4. Every review must belong to a signed-in customer.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'order_reviews_reviewer_required_check'
      AND conrelid = 'public.order_reviews'::regclass
  ) THEN
    ALTER TABLE public.order_reviews
      ADD CONSTRAINT order_reviews_reviewer_required_check
      CHECK (user_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- 5. Data API access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_reviews TO authenticated;
GRANT ALL ON public.order_reviews TO service_role;

-- 6. Customer write policies (photo path must live in the customer's folder).
DROP POLICY IF EXISTS "Customers can review their own completed orders" ON public.order_reviews;
DROP POLICY IF EXISTS "Customers can review completed orders or general visits" ON public.order_reviews;

CREATE POLICY "Customers can review completed orders or general visits"
ON public.order_reviews FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND (photo_path IS NULL OR photo_path LIKE auth.uid()::text || '/%')
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

DROP POLICY IF EXISTS "Customers can edit their own review" ON public.order_reviews;

CREATE POLICY "Customers can edit their own review"
ON public.order_reviews FOR UPDATE TO authenticated
USING (auth.uid() = user_id AND status = 'pending')
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND (photo_path IS NULL OR photo_path LIKE auth.uid()::text || '/%')
);

-- ---------------------------------------------------------------------------
-- 7. STORAGE — uses the EXISTING private bucket `review-photos`.
--    Do NOT create a new bucket. This bucket already exists in the project
--    and already enforces image-only MIME types, so only the policies below
--    are (re)applied. Photos only — no video bucket, path or policy.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Customers upload their own review photos" ON storage.objects;
CREATE POLICY "Customers upload their own review photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'review-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Customers read their own review photos" ON storage.objects;
CREATE POLICY "Customers read their own review photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'review-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Customers delete their own review photos" ON storage.objects;
CREATE POLICY "Customers delete their own review photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'review-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Restaurant team reads review photos" ON storage.objects;
CREATE POLICY "Restaurant team reads review photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'review-photos'
  AND (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'staff')
  )
);
