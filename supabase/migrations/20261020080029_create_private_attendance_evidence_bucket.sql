-- Recovered TEST source from verified bucket settings. Not Production.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('attendance-evidence','attendance-evidence',false,1500000,ARRAY['image/jpeg']::text[]) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, public=false, file_size_limit=1500000, allowed_mime_types=ARRAY['image/jpeg']::text[];
