-- One inbox: human decisions bound to an exact artifact version, with an append-only verdict ledger.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A decision is one human call. artifact_hash is sha256 over canonical JSON (lib/decisions.ts);
--     any later change to the artifact makes a verdict refused with reason "changed".
--   * decisions holds current state; decision_verdicts is the audit trail and is append-only for the
--     owner (select + insert policies only, mirroring ledger_entries in 0007). Every verdict records
--     actor, timestamp, artifact hash and reason. A child table is used rather than columns on the
--     parent because one decision can carry several verdicts (request_changes -> edit_accept) and the
--     history must never be rewritten when the card moves again.
--   * Owner-only RLS on both tables, same pattern as 0002/0004/0005/0007.
--   * Workers and the outcome hook write through the service role.

begin;

create table if not exists public.decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('approval', 'review', 'question', 'blocker')),
  title text not null default '' check (char_length(title) between 1 and 280),
  summary text not null default '' check (char_length(summary) <= 2000),
  artifact_ref text not null default '' check (char_length(artifact_ref) <= 500),
  artifact_hash text not null check (char_length(artifact_hash) = 64),
  requested_by_run uuid references public.task_runs(id) on delete set null,
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  reason text check (reason is null or char_length(reason) <= 2000),
  status text not null default 'pending' check (
    status in (
      'pending', 'approved', 'changes_requested', 'edited_accepted',
      'reassigned', 'escalated', 'answered', 'snoozed', 'expired'
    )
  ),
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  expires_at timestamptz,
  snoozed_until timestamptz,
  producer_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists decisions_workspace_status_idx on public.decisions (workspace_id, status);
create index if not exists decisions_requested_by_run_idx on public.decisions (requested_by_run);

create table if not exists public.decision_verdicts (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  verdict text not null check (
    verdict in ('approve', 'request_changes', 'edit_accept', 'reassign', 'escalate', 'answer', 'snooze')
  ),
  status text not null check (
    status in (
      'pending', 'approved', 'changes_requested', 'edited_accepted',
      'reassigned', 'escalated', 'answered', 'snoozed', 'expired'
    )
  ),
  artifact_hash text not null check (char_length(artifact_hash) = 64),
  reason text check (reason is null or char_length(reason) <= 2000),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists decision_verdicts_decision_created_idx
  on public.decision_verdicts (decision_id, created_at);
create index if not exists decision_verdicts_workspace_created_idx
  on public.decision_verdicts (workspace_id, created_at desc);

alter table public.decisions enable row level security;
alter table public.decision_verdicts enable row level security;

drop policy if exists decisions_all_owner on public.decisions;
create policy decisions_all_owner on public.decisions for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

-- Append-only audit for the owner: select and insert only. No update or delete policy exists.
drop policy if exists decision_verdicts_select_owner on public.decision_verdicts;
create policy decision_verdicts_select_owner on public.decision_verdicts for select to authenticated
  using (
    workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists decision_verdicts_insert_owner on public.decision_verdicts;
create policy decision_verdicts_insert_owner on public.decision_verdicts for insert to authenticated
  with check (
    workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (actor_id is null or actor_id = (select auth.uid()))
  );

commit;

notify pgrst, 'reload schema';
