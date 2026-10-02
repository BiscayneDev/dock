-- Per-user capabilities (slice 4, PR A: foundation).
--
-- A capability is something a user adds to their Dinghy by chatting: a logged-in
-- site session today, other kinds later (a learned workflow, an API key, a
-- connected account). Each one is a per-user, scoped, expiring, revocable row,
-- created from a texted one-use link, never from secrets typed into chat.
--
-- kind = 'browser_session': scope = {"site": "github.com"}, secret_enc = the
-- cookie storage state encrypted with the existing AES-GCM helper
-- (src/lib/crypto.ts, encryptTokenForDb). Nothing here is readable by
-- anon/authenticated; only the server (service role) touches it.

create table if not exists public.user_capabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind text not null check (kind in ('browser_session')),
  label text not null,                       -- what the user calls it, e.g. "github.com"
  scope jsonb not null default '{}'::jsonb,  -- kind-specific limits, e.g. {"site": "github.com"}
  mode text not null default 'read' check (mode in ('read', 'write')),
  secret_enc text,                           -- encryptTokenForDb(...) payload, kind-specific
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);
-- One live capability per user + kind + label; reconnecting replaces it.
create unique index if not exists user_capabilities_live
  on public.user_capabilities (user_id, kind, label) where revoked_at is null;
alter table public.user_capabilities enable row level security;
revoke all on public.user_capabilities from anon, authenticated, public;

-- One-use, short-lived connect attempts. Raw token never stored: sha256 only.
create table if not exists public.capability_connect_attempts (
  token_hash text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  chat_guid text,
  kind text not null,
  params jsonb not null default '{}'::jsonb, -- e.g. {"site": "github.com", "sandbox_id": "..."}
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.capability_connect_attempts enable row level security;
revoke all on public.capability_connect_attempts from anon, authenticated, public;

-- Audit trail of capability use. No secret material, no page content.
create table if not exists public.capability_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  capability_id uuid references public.user_capabilities (id) on delete set null,
  kind text not null,
  label text not null,
  mode text not null,
  task text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  outcome text,
  detail jsonb not null default '{}'::jsonb  -- e.g. {"requests": 14, "blocked": 0, "hosts": ["github.com"]}
);
alter table public.capability_runs enable row level security;
revoke all on public.capability_runs from anon, authenticated, public;
create index if not exists capability_runs_user_started on public.capability_runs (user_id, started_at desc);

create or replace function public.create_capability_connect_attempt(p_hash text, p_user uuid, p_chat text, p_kind text, p_params jsonb, p_ttl_seconds int)
returns void language sql security definer set search_path = public as $$
  insert into public.capability_connect_attempts (token_hash, user_id, chat_guid, kind, params, expires_at)
  values (p_hash, p_user, p_chat, p_kind, coalesce(p_params, '{}'::jsonb), now() + make_interval(secs => p_ttl_seconds));
  delete from public.capability_connect_attempts where expires_at < now() - interval '1 day';
$$;

-- Read a live attempt without using it (the page checks before showing itself).
create or replace function public.peek_capability_connect_attempt(p_hash text)
returns table (user_id uuid, chat_guid text, kind text, params jsonb) language sql security definer set search_path = public as $$
  select a.user_id, a.chat_guid, a.kind, a.params from public.capability_connect_attempts a
  where a.token_hash = p_hash and a.used_at is null and a.expires_at > now();
$$;

-- Merge more params into a live attempt (e.g. the login sandbox id once started).
create or replace function public.update_capability_connect_attempt(p_hash text, p_params jsonb)
returns boolean language sql security definer set search_path = public as $$
  with u as (
    update public.capability_connect_attempts a set params = a.params || coalesce(p_params, '{}'::jsonb)
    where a.token_hash = p_hash and a.used_at is null and a.expires_at > now()
    returning 1
  ) select exists (select 1 from u);
$$;

-- Atomically use a live attempt. No row if already used or expired.
create or replace function public.consume_capability_connect_attempt(p_hash text)
returns table (user_id uuid, chat_guid text, kind text, params jsonb) language sql security definer set search_path = public as $$
  update public.capability_connect_attempts a set used_at = now()
  where a.token_hash = p_hash and a.used_at is null and a.expires_at > now()
  returning a.user_id, a.chat_guid, a.kind, a.params;
$$;

revoke all on function public.create_capability_connect_attempt(text, uuid, text, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.peek_capability_connect_attempt(text) from public, anon, authenticated;
revoke all on function public.update_capability_connect_attempt(text, jsonb) from public, anon, authenticated;
revoke all on function public.consume_capability_connect_attempt(text) from public, anon, authenticated;
grant execute on function public.create_capability_connect_attempt(text, uuid, text, text, jsonb, int) to service_role;
grant execute on function public.peek_capability_connect_attempt(text) to service_role;
grant execute on function public.update_capability_connect_attempt(text, jsonb) to service_role;
grant execute on function public.consume_capability_connect_attempt(text) to service_role;

notify pgrst, 'reload schema';
