-- DRAFT ONLY, not applied. Durable lifecycle, not a self-authorizing task queue.
-- No executable RPC/owner approval endpoint is installed by this migration.
-- An exact reviewed proposal+source+budget+cleanup decision must be bound before
-- future controller execution. There is deliberately no 'approve from chat'.
begin;
create table public.mobile_executions(
 id uuid primary key default gen_random_uuid(),
 proposal_id uuid not null references public.mobile_task_proposals(id),
 owner_id uuid not null references public.users(id),workspace_id uuid not null references public.workspaces(id),
 project_id uuid references public.projects(id),parent_execution_id uuid references public.mobile_executions(id),
 root_execution_id uuid references public.mobile_executions(id),agent_key text not null,
 repo_key text not null,source_commit text not null check(source_commit~'^[a-f0-9]{40}$'),
 approved_proposal_digest text not null,owner_decision_ref text not null,
 managed_budget_micros bigint not null check(managed_budget_micros>=0),
 max_compute_cost_micros bigint not null check(max_compute_cost_micros>0),
 lifecycle_approved boolean not null default false,cleanup_deadline timestamptz not null,
 state text not null default 'proposed'check(state in('proposed','approved','provision_intent','bound','start_intent','running','complete','failed','reconcile','cleanup_pending','cleanup_confirmed')),
 instance_id text unique,thread_id text,run_id text,result text,
 cleanup_attempts integer not null default 0,cleanup_last_error text,
 cleanup_confirmed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(proposal_id,approved_proposal_digest,agent_key)
);
create table public.mobile_execution_events(
 id bigint generated always as identity primary key,execution_id uuid not null references public.mobile_executions(id),
 kind text not null,details jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.mobile_executions enable row level security;
alter table public.mobile_execution_events enable row level security;
revoke all on public.mobile_executions,public.mobile_execution_events from anon,authenticated;
commit;
