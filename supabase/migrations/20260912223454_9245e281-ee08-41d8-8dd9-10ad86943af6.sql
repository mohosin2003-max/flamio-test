ALTER TABLE public.promo_banners
  ADD COLUMN desktop_image_path text,
  ADD COLUMN mobile_image_path text;

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