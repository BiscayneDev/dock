-- Event listeners and monitors (WS4): webhook-triggered agents with verified ingress, filter rules,
-- idempotency/dedupe, replay protection and a delivery audit trail.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A listener belongs to one workspace and one owner. The webhook token is a high-entropy bearer
--     secret shown once at creation; only sha256("<salt>:<secret>") with a per-row salt is stored,
--     unique per workspace. Nothing here prints or returns the plaintext after insert.
--   * Deliveries are the audit trail for inbound events: status enqueued|filtered|deduped|paused|
--     error, plus the run an accepted event created. They are written through the service role by
--     the unauthenticated webhook route (the URL token is the credential) and are read-only for the
--     owner: select policy only, no update/delete policy exists.
--   * Owner-only RLS on both tables, same policy shape as 0013/0012.
--   * The circuit breaker (lib/listener-dispatch.ts) pauses a listener by setting paused_at/
--     pause_reason after >=10 errored deliveries among its last 20; enabling the listener clears
--     the pause state.

begin;

create table if not exists public.listeners (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  token_salt text not null check (char_length(token_salt) = 32),
  token_hash text not null check (char_length(token_hash) = 64),
  filter_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(filter_rules) = 'object'),
  target_agent_key text not null check (char_length(target_agent_key) between 1 and 64),
  runbook text not null check (char_length(runbook) between 1 and 8000),
  enabled boolean not null default true,
  trigger_count integer not null default 0 check (trigger_count >= 0),
  last_triggered_at timestamptz,
  paused_at timestamptz,
  pause_reason text check (pause_reason is null or char_length(pause_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint listeners_workspace_token_hash_unique unique (workspace_id, token_hash)
);
create index if not exists listeners_workspace_enabled_idx
  on public.listeners (workspace_id, enabled, created_at desc);

create table if not exists public.listener_deliveries (
  id uuid primary key default gen_random_uuid(),
  listener_id uuid not null references public.listeners(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_id text not null check (char_length(event_id) between 1 and 200),
  status text not null check (status in ('enqueued', 'filtered', 'deduped', 'paused', 'error')),
  detail text check (detail is null or char_length(detail) <= 1000),
  run_id uuid references public.task_runs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists listener_deliveries_listener_created_idx
  on public.listener_deliveries (listener_id, created_at desc);
create index if not exists listener_deliveries_listener_event_idx
  on public.listener_deliveries (listener_id, event_id, created_at desc);
create index if not exists listener_deliveries_workspace_created_idx
  on public.listener_deliveries (workspace_id, created_at desc);

alter table public.listeners enable row level security;
alter table public.listener_deliveries enable row level security;

drop policy if exists listeners_all_owner on public.listeners;
create policy listeners_all_owner on public.listeners for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

-- Append-only audit for the owner: select only. Inserts come from the service-role webhook route.
drop policy if exists listener_deliveries_select_owner on public.listener_deliveries;
create policy listener_deliveries_select_owner on public.listener_deliveries for select to authenticated
  using (
    workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

commit;

notify pgrst, 'reload schema';
