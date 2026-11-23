-- AYRA Trading — a minimal Supabase stand-in for tests on a real PostgreSQL (scripts/test-concurrency.sh). NEVER run on
-- a real Supabase project. Roles as in Supabase: API roles without login, «authenticator» logs in and switches to them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  -- the auth server's own role (Supabase): it runs the Custom Access Token Hook of 0018
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'authenticator-test-only';
  END IF;
END $$;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_app_meta_data jsonb DEFAULT '{}'::jsonb);
-- as in Supabase Auth (the columns 0018 uses): the app_metadata of the user, sessions and refresh tokens
CREATE TABLE IF NOT EXISTS auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(), not_after timestamptz);
CREATE TABLE IF NOT EXISTS auth.refresh_tokens (id bigserial PRIMARY KEY, token varchar(255), user_id varchar(255),
  revoked boolean DEFAULT false, session_id uuid REFERENCES auth.sessions(id) ON DELETE CASCADE);
-- same as Supabase: the user id comes from the JWT claim set for the request (NULL when signed out)
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
