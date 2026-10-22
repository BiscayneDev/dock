-- Task queue for the cloud worker (P2). Idempotent: safe to re-run.
-- Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A run belongs to one workspace and one owner. Owner-only RLS on both tables.
--   * Workers write through the service role only. Events are append-only for the owner (read).
--   * claim_task_run() is the only way to lease a run. It is service-role only.
--   * Leases: status leased|running with lease_until in the past is recovered by the next claim
--     (requeued while attempts < max_attempts, otherwise failed). Each recovery writes an event.

begin;

create table if not exists public.task_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  agent_key text not null default 'vic' check (char_length(agent_key) <= 64),
  target text not null default 'cloud' check (target in ('cloud', 'home', 'sandbox')),
  status text not null default 'queued' check (
    status in ('queued', 'leased', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')
  ),
  payload jsonb not null default '{}'::jsonb,
  model text check (model is null or char_length(model) <= 200),
  budget_cents integer not null default 0 check (budget_cents >= 0),
  spent_cents integer not null default 0 check (spent_cents >= 0),
  lease_owner text check (lease_owner is null or char_length(lease_owner) <= 200),
  lease_until timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  error text check (error is null or char_length(error) <= 4000),
  output text check (output is null or char_length(output) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists task_runs_status_lease_idx on public.task_runs (status, lease_until);
create index if not exists task_runs_owner_created_idx on public.task_runs (owner_id, created_at desc);

create table if not exists public.task_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.task_runs(id) on delete cascade,
  kind text not null check (char_length(kind) <= 64),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists task_run_events_run_created_idx on public.task_run_events (run_id, created_at);

alter table public.task_runs enable row level security;
alter table public.task_run_events enable row level security;

drop policy if exists task_runs_all_owner on public.task_runs;
create policy task_runs_all_owner on public.task_runs for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (
      project_id is null
      or project_id in (select p.id from public.projects p where p.workspace_id = public.task_runs.workspace_id)
    )
  );

drop policy if exists task_run_events_select_owner on public.task_run_events;
create policy task_run_events_select_owner on public.task_run_events for select to authenticated
  using (run_id in (select r.id from public.task_runs r where r.owner_id = (select auth.uid())));

-- Lease one queued run. Recovers expired leases first (writes an event per recovered run).
-- Single UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) so concurrent claims never share a row.
create or replace function public.claim_task_run(p_worker text, p_lease_seconds integer default 120)
returns setof public.task_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.task_runs;
begin
  if p_worker is null or char_length(p_worker) = 0 or char_length(p_worker) > 200 then
    raise exception 'invalid worker id';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'lease must be 10..900 seconds';
  end if;

  with recovered as (
    update public.task_runs t
       set status = case when t.attempts >= t.max_attempts then 'failed' else 'queued' end,
           error = case when t.attempts >= t.max_attempts then 'lease expired' else t.error end,
           finished_at = case when t.attempts >= t.max_attempts then now() else t.finished_at end,
           lease_owner = null,
           lease_until = null,
           updated_at = now()
     where t.status in ('leased', 'running') and t.lease_until < now()
    returning t.id, t.status, t.attempts, t.lease_owner
  )
  insert into public.task_run_events (run_id, kind, data)
  select id, 'lease_expired',
         jsonb_build_object('next_status', status, 'attempts', attempts, 'previous_worker', lease_owner)
    from recovered;

  update public.task_runs t
     set status = 'leased',
         lease_owner = p_worker,
         lease_until = now() + make_interval(secs => p_lease_seconds),
         attempts = t.attempts + 1,
         started_at = coalesce(t.started_at, now()),
         updated_at = now()
   where t.id = (
           select q.id from public.task_runs q
            where q.status = 'queued'
            order by q.created_at
            for update skip locked
            limit 1
         )
     and t.status = 'queued'
  returning t.* into r;

  if found then
    insert into public.task_run_events (run_id, kind, data)
    values (r.id, 'leased', jsonb_build_object('worker', p_worker, 'attempt', r.attempts));
    return next r;
  end if;
  return;
end;
$$;

revoke all on function public.claim_task_run(text, integer) from public;
revoke all on function public.claim_task_run(text, integer) from anon;
revoke all on function public.claim_task_run(text, integer) from authenticated;
grant execute on function public.claim_task_run(text, integer) to service_role;

commit;

notify pgrst, 'reload schema';
