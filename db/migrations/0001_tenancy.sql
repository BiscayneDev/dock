-- P1 tenancy: per-user data with row-level security.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * App tables reference public.users (app user id). public.users.id = auth.users.id,
--     and that row is the only auth link.
--   * RLS is enabled on every app table. The service role bypasses RLS.
--   * invites and beta_allowlist have no policies for anon/authenticated: service role only.

begin;

create extension if not exists pgcrypto;

-- Auth link. One row per signed-in user (created by the app on first use).
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null default '',
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

-- One workspace per user for now (owner_id is unique).
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.users(id) on delete cascade,
  building text not null default '' check (char_length(building) <= 1000),
  main_goal text not null default '' check (char_length(main_goal) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  goal text not null default '' check (char_length(goal) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_workspace_idx on public.projects (workspace_id);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('chief_of_staff', 'subagent')),
  display_name text not null check (char_length(display_name) between 1 and 24),
  role text not null default '',
  persona text not null default '' check (char_length(persona) <= 4000),
  -- Runtime key used by the existing chat path (lib/inference resolveModel, AGENT_MODEL_<KEY>).
  runtime_agent text not null default 'vic',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Display names are unique per workspace, case-insensitive.
create unique index if not exists agents_name_per_workspace
  on public.agents (workspace_id, lower(display_name));
-- Exactly one Chief of Staff per workspace.
create unique index if not exists agents_one_chief_per_workspace
  on public.agents (workspace_id) where kind = 'chief_of_staff';

-- Invites: service role writes and reads. The token itself is never stored, only its SHA-256.
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  invited_by text,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Beta allowlist: service role writes. revoked_at set = access removed.
create table if not exists public.beta_allowlist (
  email text primary key check (email = lower(email)),
  added_by text,
  added_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Lets a signed-in session ask "am I a beta member?" without reading the allowlist table.
create or replace function public.is_beta_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.beta_allowlist b
    where b.email = lower(coalesce(auth.email(), ''))
      and b.revoked_at is null
  )
$$;
revoke all on function public.is_beta_member() from public;
grant execute on function public.is_beta_member() to authenticated;

-- RLS on every app table.
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.projects enable row level security;
alter table public.agents enable row level security;
alter table public.invites enable row level security;
alter table public.beta_allowlist enable row level security;

-- Service-only tables: no policies, and no grants for the client roles.
revoke all on public.invites from anon, authenticated;
revoke all on public.beta_allowlist from anon, authenticated;

-- users: a user sees and writes only their own row.
drop policy if exists users_select_own on public.users;
create policy users_select_own on public.users for select to authenticated
  using (id = (select auth.uid()));
drop policy if exists users_insert_own on public.users;
create policy users_insert_own on public.users for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists users_update_own on public.users;
create policy users_update_own on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- profiles: own row only.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- workspaces: owner only.
drop policy if exists workspaces_select_owner on public.workspaces;
create policy workspaces_select_owner on public.workspaces for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists workspaces_insert_owner on public.workspaces;
create policy workspaces_insert_owner on public.workspaces for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists workspaces_update_owner on public.workspaces;
create policy workspaces_update_owner on public.workspaces for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- projects: visible and writable only inside workspaces the user owns.
drop policy if exists projects_all_owner on public.projects;
create policy projects_all_owner on public.projects for all to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())));

-- agents: same rule as projects.
drop policy if exists agents_all_owner on public.agents;
create policy agents_all_owner on public.agents for all to authenticated
  using (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())))
  with check (workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';
