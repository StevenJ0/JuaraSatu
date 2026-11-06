-- TEST-ONLY auth stand-in for isolated PostgreSQL; never apply as a Supabase migration.
-- Real Supabase owns auth.users and verifies JWTs. Tests exercise DB role/RLS semantics only.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid(),auth.role() TO anon,authenticated,service_role;
INSERT INTO auth.users VALUES
 ('11111111-1111-4111-8111-111111111111','owner-a@example.test'),
 ('22222222-2222-4222-8222-222222222222','owner-b@example.test');
