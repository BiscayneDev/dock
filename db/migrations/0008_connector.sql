-- Dinghy connector (P3): connector connections, one-time pairing codes, and approvals relayed to Dinghy.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * Connector tokens are never stored. Only sha256(salt:secret) with a per-row salt (same scheme as devices, 0006).
--   * Pairing codes are single use and expire after 10 minutes. redeem_connector_pairing() is the only way to consume one.
--   * One live connection per workspace. Redeeming a new code revokes the old connection and expires its pending approvals.
--   * Tables are owner-readable (RLS). All writes go through the service role.
--   * Run dedupe: a connector run is unique per (connection, client_message_id).

begin;

create table if not exists public.dock_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  link_ref text not null unique check (char_length(link_ref) between 16 and 128),
  dinghy_user_ref text check (dinghy_user_ref is null or char_length(dinghy_user_ref) <= 200),
  token_salt text check (token_salt is null or char_length(token_salt) between 16 and 128),
  token_hash text check (token_hash is null or char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create index if not exists dock_connections_owner_idx on public.dock_connections (owner_id, created_at desc);
create unique index if not exists dock_connections_one_live on public.dock_connections (workspace_id) where revoked_at is null;

create table if not exists public.connector_pairings (
  code_hash text primary key check (char_length(code_hash) = 64),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists connector_pairings_owner_idx on public.connector_pairings (owner_id, created_at desc);

create table if not exists public.connector_approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.dock_connections(id) on delete cascade,
  run_id uuid references public.task_runs(id) on delete set null,
  action jsonb not null default '{}'::jsonb,
  label text not null check (char_length(label) between 1 and 80),
  details_hash text not null check (char_length(details_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  decided_at timestamptz
);
create index if not exists connector_approvals_connection_idx on public.connector_approvals (connection_id, status);
create index if not exists connector_approvals_run_idx on public.connector_approvals (run_id);

alter table public.dock_connections enable row level security;
alter table public.connector_pairings enable row level security;
alter table public.connector_approvals enable row level security;

drop policy if exists dock_connections_select_owner on public.dock_connections;
create policy dock_connections_select_owner on public.dock_connections for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists connector_pairings_select_owner on public.connector_pairings;
create policy connector_pairings_select_owner on public.connector_pairings for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists connector_approvals_select_owner on public.connector_approvals;
create policy connector_approvals_select_owner on public.connector_approvals for select to authenticated
  using (owner_id = (select auth.uid()));

-- Run dedupe for connector runs. Partial index: only runs that carry connector metadata.
create unique index if not exists task_runs_connector_dedupe
  on public.task_runs ((payload #>> '{connector,connection_id}'), (payload #>> '{connector,client_message_id}'))
  where payload ? 'connector';

-- Consume a pairing code and create the connection, atomically. Replaces any live connection for the workspace.
-- Returns one row (connection id, workspace, owner) or no rows when the code is unknown, used, or expired.
create or replace function public.redeem_connector_pairing(
  p_code_hash text,
  p_link_ref text,
  p_token_salt text,
  p_token_hash text
)
returns table (connection_id uuid, workspace_id uuid, owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.connector_pairings;
  v_id uuid;
begin
  if p_code_hash is null or char_length(p_code_hash) <> 64 then raise exception 'invalid pairing'; end if;
  if p_link_ref is null or char_length(p_link_ref) not between 16 and 128 then raise exception 'invalid link_ref'; end if;
  if p_token_salt is null or char_length(p_token_salt) not between 16 and 128 then raise exception 'invalid salt'; end if;
  if p_token_hash is null or char_length(p_token_hash) <> 64 then raise exception 'invalid token hash'; end if;

  update public.connector_pairings cp
     set used_at = now()
   where cp.code_hash = p_code_hash
     and cp.used_at is null
     and cp.expires_at > now()
  returning cp.* into p;

  if not found then return; end if;

  -- Replace the workspace's live connection, and expire anything it left pending.
  update public.connector_approvals a
     set status = 'expired', decided_at = now()
   where a.status = 'pending'
     and a.connection_id in (
       select c.id from public.dock_connections c where c.workspace_id = p.workspace_id and c.revoked_at is null
     );
  update public.dock_connections c
     set revoked_at = now()
   where c.workspace_id = p.workspace_id and c.revoked_at is null;

  insert into public.dock_connections (workspace_id, owner_id, link_ref, token_salt, token_hash)
  values (p.workspace_id, p.owner_id, p_link_ref, p_token_salt, p_token_hash)
  returning id into v_id;

  return query select v_id, p.workspace_id, p.owner_id;
end;
$$;

revoke all on function public.redeem_connector_pairing(text, text, text, text) from public;
revoke all on function public.redeem_connector_pairing(text, text, text, text) from anon;
revoke all on function public.redeem_connector_pairing(text, text, text, text) from authenticated;
grant execute on function public.redeem_connector_pairing(text, text, text, text) to service_role;

commit;

notify pgrst, 'reload schema';
