-- Shipyard connect (Dock): per-workspace gateway key, owner-only RLS.
-- The key is sealed server-side (AES-256-GCM, SHIPYARD_CONNECT_ENC_KEY); the browser never reads it.

create table if not exists public.workspace_shipyard_connections (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  owner         uuid not null references auth.users(id) on delete cascade,
  key_id        text not null,
  encrypted_key text not null,
  scopes        text[] not null default '{}',
  budget_usd    numeric(10,2) not null default 10,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz
);

-- One active connection per workspace.
create unique index if not exists workspace_shipyard_connections_active_idx
  on public.workspace_shipyard_connections (workspace_id) where revoked_at is null;

alter table public.workspace_shipyard_connections enable row level security;

drop policy if exists "owner reads own shipyard connections" on public.workspace_shipyard_connections;
create policy "owner reads own shipyard connections" on public.workspace_shipyard_connections
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "owner creates own shipyard connections" on public.workspace_shipyard_connections;
create policy "owner creates own shipyard connections" on public.workspace_shipyard_connections
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "owner updates own shipyard connections" on public.workspace_shipyard_connections;
create policy "owner updates own shipyard connections" on public.workspace_shipyard_connections
  for update to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));

drop policy if exists "owner deletes own shipyard connections" on public.workspace_shipyard_connections;
create policy "owner deletes own shipyard connections" on public.workspace_shipyard_connections
  for delete to authenticated using (owner = (select auth.uid()));

-- PKCE state, single use, bound to the user and workspace that started the connect.
create table if not exists public.workspace_shipyard_connect_states (
  state          text primary key,
  owner          uuid not null references auth.users(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  verifier_sealed text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

alter table public.workspace_shipyard_connect_states enable row level security;

drop policy if exists "owner manages own connect states" on public.workspace_shipyard_connect_states;
create policy "owner manages own connect states" on public.workspace_shipyard_connect_states
  for all to authenticated using (owner = (select auth.uid())) with check (owner = (select auth.uid()));
