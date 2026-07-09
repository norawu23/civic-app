-- tests/lib/pg-local-stub.sql
--
-- Minimal Supabase-environment stub for running the DB test suites against
-- a plain Postgres server (no Docker) via CIVIC_TEST_DB_URL (see
-- tests/lib/supabase-stack.mjs). Recreates just enough of the
-- supabase/postgres image for supabase/migrations/*.sql to apply from empty
-- and for the suites' `set role` + request.jwt.claims technique to work:
--
--   * the three client roles (anon / authenticated / service_role)
--   * schema usage grants + default privileges — Supabase's permissive
--     defaults are deliberately reproduced, because the grant-wall and RLS
--     layers on top of them are exactly what the suites test
--   * the auth schema: auth.users (the columns 0002's trigger reads) and
--     auth.uid() reading the request.jwt.claims GUC
--
-- Matches the stub used for the operator's A2/A3 PG15 verifications (D-009).
-- Apply ONCE to a fresh database, BEFORE supabase/migrations/*.sql:
--
--   createdb civic_test
--   psql -d civic_test -f tests/lib/pg-local-stub.sql
--   for f in supabase/migrations/*.sql; do psql -d civic_test -v ON_ERROR_STOP=1 -f "$f"; done
--   CIVIC_TEST_DB_URL=postgresql:///civic_test node tests/run-all.mjs

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  instance_id uuid,
  id uuid not null primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  -- GoTrue token columns the auth suites' signup inserts reference (always
  -- present in the real supabase image; empty strings there, empty here).
  confirmation_token varchar(255),
  recovery_token varchar(255),
  email_change_token_new varchar(255),
  email_change varchar(255)
);

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
