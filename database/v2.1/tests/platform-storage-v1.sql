-- TEST ONLY v1: the Storage SQL surface referenced by root migrations, not the Storage service.
-- Authenticated SQL privileges stand in for platform grants; application policies come from migrations.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
 id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]
);
CREATE TABLE storage.objects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,
 UNIQUE(bucket_id,name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
GRANT SELECT ON storage.buckets TO authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON storage.objects TO authenticated,service_role;
