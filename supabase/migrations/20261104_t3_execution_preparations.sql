-- DRAFT ONLY. Preparation records do not authorize funding/provisioning/launch.
-- No production migration applied. Durable owner/task mapping replaces local fs
-- only for this narrow preparation/claim slice, not the complete bridge lifecycle.
create table public.t3_execution_preparations (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null unique references public.task_runs(id) on delete restrict,
 owner_id uuid not null references public.users(id),
 workspace_id uuid not null references public.workspaces(id),
 project_id uuid not null references public.projects(id),
 isolated_task jsonb not null check(jsonb_typeof(isolated_task)='object'),
 base_sha text not null check(base_sha ~ '^[a-f0-9]{40}$'),
 private_execution_id text unique check(private_execution_id ~ '^[a-z0-9]{1,64}$'),
 phase text not null default 'prepared' check(phase in ('prepared','claimed','cleanup_due','deleted')),
 version integer not null default 1 check(version>0),
 lease_owner text,
 lease_until timestamptz,
 cleanup_deadline timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.t3_execution_preparations enable row level security;
revoke all on public.t3_execution_preparations from anon, authenticated;
grant select on public.t3_execution_preparations to authenticated;
create policy owner_reads_t3_preparations on public.t3_execution_preparations
 for select to authenticated using(owner_id=auth.uid() and exists(
 select 1 from public.workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
-- Mutations are narrow RPCs only; an owner cannot mark an execution deleted.
grant all on public.t3_execution_preparations to service_role;

create function public.prepare_t3_execution(p_run_id uuid,p_base_sha text,p_cleanup_deadline timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r task_runs%rowtype; existing t3_execution_preparations%rowtype; result_id uuid;
begin
 if auth.uid() is null then raise exception 'owner session required'; end if;
 if p_base_sha is null or p_base_sha !~ '^[a-f0-9]{40}$' or p_cleanup_deadline is null
 or p_cleanup_deadline<=now() or p_cleanup_deadline>now()+interval '30 minutes' then raise exception 'invalid preparation'; end if;
 select * into r from task_runs where id=p_run_id for update;
 if not found or r.owner_id<>auth.uid() or r.project_id is null or r.status<>'queued'
 or r.target<>'home' or jsonb_typeof(r.payload->'isolatedTask') is distinct from 'object'
 or coalesce(r.payload->'isolatedTask'->>'taskRef','') !~ '^task-[a-z0-9][a-z0-9-]{0,62}$'
 or coalesce(r.payload->'isolatedTask'->>'repoKey','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$'
 or coalesce(r.payload->'isolatedTask'->>'baseRef','') !~ '^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,100}$'
 or position('..' in (r.payload->'isolatedTask'->>'baseRef'))>0
 or length(btrim(coalesce(r.payload->'isolatedTask'->>'brief',''))) not between 1 and 8000
 or r.payload->'proposedAction' is not null or r.lease_owner is not null
 or not exists(select 1 from workspaces w where w.id=r.workspace_id and w.owner_id=auth.uid())
 or not exists(select 1 from projects p where p.id=r.project_id and p.workspace_id=r.workspace_id)
 then raise exception 'run not available for owner preparation'; end if;
 select * into existing from t3_execution_preparations where run_id=r.id;
 if found then
  if existing.owner_id is distinct from r.owner_id or existing.workspace_id is distinct from r.workspace_id or existing.project_id is distinct from r.project_id or existing.isolated_task is distinct from r.payload->'isolatedTask' or existing.base_sha<>p_base_sha or existing.cleanup_deadline<>p_cleanup_deadline then raise exception 'immutable preparation conflict'; end if;
  return jsonb_build_object('id',existing.id,'phase',existing.phase,'version',existing.version);
 end if;
 insert into t3_execution_preparations(run_id,owner_id,workspace_id,project_id,isolated_task,base_sha,cleanup_deadline)
 values(r.id,r.owner_id,r.workspace_id,r.project_id,r.payload->'isolatedTask',p_base_sha,p_cleanup_deadline) returning id into result_id;
 return jsonb_build_object('id',result_id,'phase','prepared','version',1);
end $$;
revoke all on function public.prepare_t3_execution(uuid,text,timestamptz) from public,anon;
grant execute on function public.prepare_t3_execution(uuid,text,timestamptz) to authenticated;

-- Backend only. This records an ALREADY approved/provisioned private execution.
-- It creates no instance and carries no owner spend grant. Claim callers must
-- independently verify authority + active supervised admin policy before launch.
create function public.claim_t3_preparation(p_id uuid,p_expected integer,p_execution text,p_worker text,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare b t3_execution_preparations%rowtype; r task_runs%rowtype;
begin
 if p_execution is null or p_execution !~ '^[a-z0-9]{1,64}$' or p_worker is null or p_worker !~ '^t3:[a-zA-Z0-9_-]{1,64}$'
 or p_lease_seconds is null or p_lease_seconds<10 or p_lease_seconds>180 then raise exception 'invalid binding'; end if;
 select * into b from t3_execution_preparations where id=p_id;
 if not found then return jsonb_build_object('ok',false,'reason','missing'); end if;
 -- Consistent lock order with preparation and queue claims: task first.
 select * into r from task_runs where id=b.run_id for update;
 select * into b from t3_execution_preparations where id=p_id for update;
 if not found or b.version is distinct from p_expected or b.phase<>'prepared' or b.cleanup_deadline<=now() or r.status<>'queued'
 or r.lease_owner is not null or r.target<>'home' or r.payload->'isolatedTask' is distinct from b.isolated_task
 or r.payload->'proposedAction' is not null or r.owner_id is distinct from b.owner_id or r.workspace_id is distinct from b.workspace_id or r.project_id is distinct from b.project_id
 or not exists(select 1 from workspaces w where w.id=b.workspace_id and w.owner_id=b.owner_id)
 or not exists(select 1 from projects p where p.id=b.project_id and p.workspace_id=b.workspace_id)
 then return jsonb_build_object('ok',false,'reason','conflict'); end if;
 update t3_execution_preparations set phase='claimed',version=version+1,private_execution_id=p_execution,
 lease_owner=p_worker,lease_until=least(now()+make_interval(secs=>p_lease_seconds),cleanup_deadline) where id=b.id;
 update task_runs set status='leased',lease_owner=p_worker,lease_until=least(now()+make_interval(secs=>p_lease_seconds),b.cleanup_deadline) where id=r.id;
 return jsonb_build_object('ok',true,'version',b.version+1);
end $$;
revoke all on function public.claim_t3_preparation(uuid,integer,text,text,integer) from public,anon,authenticated;
grant execute on function public.claim_t3_preparation(uuid,integer,text,text,integer) to service_role;
