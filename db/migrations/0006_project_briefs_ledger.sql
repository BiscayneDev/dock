-- Project briefs and the work ledger (central thread v1). Idempotent: safe to re-run.
-- Applied with the Supabase management API, one transaction. NOT applied to any remote project yet.
--
-- Invariants:
--   * A brief is a proposal of work. It becomes a run only after an owner approves it (app enforces; see lib/briefs-store.ts).
--   * ledger_entries are append-only for the owner: RLS grants select and insert only. Reverts are new rows.
--   * Owner-only RLS on both tables, same pattern as conversations/messages (0004) and task_runs (0005).
--   * Workers and the outcome hook write through the service role.

begin;

create table if not exists public.project_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  run_id uuid references public.task_runs(id) on delete set null,
  agent_key text not null default 'vic' check (char_length(agent_key) <= 64),
  goal text not null check (char_length(goal) between 1 and 280),
  context text not null default '' check (char_length(context) <= 2000),
  deliverables jsonb not null default '[]'::jsonb check (jsonb_typeof(deliverables) = 'array'),
  budget_cents integer not null default 100 check (budget_cents between 1 and 100000),
  risk_flags text[] not null default '{}',
  state text not null default 'proposed' check (
    state in ('proposed', 'approved', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  output_summary text not null default '' check (char_length(output_summary) <= 2000),
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  finished_at timestamptz
);
create index if not exists project_briefs_project_created_idx on public.project_briefs (project_id, created_at desc);
create index if not exists project_briefs_owner_state_idx on public.project_briefs (owner_id, state);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  brief_id uuid references public.project_briefs(id) on delete set null,
  run_id uuid references public.task_runs(id) on delete set null,
  kind text not null check (kind in (
    'brief_proposed', 'brief_cancelled', 'run_started', 'run_succeeded', 'run_failed'
  )),
  agent_key text not null default 'vic' check (char_length(agent_key) <= 64),
  summary text not null default '' check (char_length(summary) <= 500),
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ledger_entries_project_created_idx on public.ledger_entries (project_id, created_at desc);

alter table public.project_briefs enable row level security;
alter table public.ledger_entries enable row level security;

drop policy if exists project_briefs_all_owner on public.project_briefs;
create policy project_briefs_all_owner on public.project_briefs for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (
      project_id is null
      or project_id in (select p.id from public.projects p where p.workspace_id = public.project_briefs.workspace_id)
    )
  );

-- Append-only for the owner: select and insert only. No update or delete policy exists.
drop policy if exists ledger_entries_select_owner on public.ledger_entries;
create policy ledger_entries_select_owner on public.ledger_entries for select to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists ledger_entries_insert_owner on public.ledger_entries;
create policy ledger_entries_insert_owner on public.ledger_entries for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

commit;

notify pgrst, 'reload schema';
