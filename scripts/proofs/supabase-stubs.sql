-- LOCAL PROOF ONLY. Minimal stand-ins for what Supabase provides outside this repository: roles, auth/storage schemas. Nothing here is an app table.
-- The repository's own migrations (0001..0025) run unmodified on top of this, except that the `create extension pgcrypto` line is skipped
-- because the local Postgres build has no pgcrypto (gen_random_uuid is built in). pgvector is REAL (extension vector).
create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key default gen_random_uuid(),email text);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.email',true),'')$$;
create function auth.role() returns text language sql stable as $$select 'service_role'::text$$;
create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
create function storage.foldername(n text) returns text[] language sql as $$select string_to_array(n,'/')$$;
create extension if not exists vector;
