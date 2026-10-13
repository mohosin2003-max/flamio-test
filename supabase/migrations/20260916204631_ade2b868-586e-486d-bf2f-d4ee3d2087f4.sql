CREATE POLICY "Customers can upload their review photo" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can view their review photo" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Customers can delete their review photo" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Restaurant team can view review photos" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'review-photos'
  AND (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'staff')
  )
);