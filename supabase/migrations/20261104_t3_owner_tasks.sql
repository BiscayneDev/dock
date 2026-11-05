-- Disabled release slice. Apply only after review. No external resources created.
create table public.t3_owner_tasks(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.users,
 request_id uuid not null,
 workspace_id uuid not null references public.workspaces,project_id uuid not null references public.projects,
 repo_key text not null,base_sha text not null check(base_sha ~ '^[a-f0-9]{40}$'),brief text not null check(length(brief) between 1 and 8000),
 result_outcome text,
 phase text not null default 'queued' check(phase in ('queued','provisioning','ready','launching','launched','review_required','uncertain','cleanup_due','deleted')),
 version int not null default 1,worker text,lease_until timestamptz,cleanup_deadline timestamptz not null,
 execution_id text unique,thread_id text,run_id text,artifact jsonb,artifact_sha256 text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(owner_id,request_id)
);
alter table public.t3_owner_tasks enable row level security;
revoke all on public.t3_owner_tasks from anon,authenticated;
grant select on public.t3_owner_tasks to authenticated;
grant all on public.t3_owner_tasks to service_role;
create policy owner_reads_t3_tasks on public.t3_owner_tasks for select to authenticated using(owner_id=auth.uid() and exists(select 1 from workspaces w where w.id=workspace_id and w.owner_id=auth.uid()));
create function public.submit_t3_owner_task(p_request uuid,p_project uuid,p_repo text,p_sha text,p_brief text,p_deadline timestamptz)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;ws uuid;
begin
 if auth.uid() is null or p_request is null then raise exception 'owner session required';end if;
 select p.workspace_id into ws from projects p join workspaces w on w.id=p.workspace_id where p.id=p_project and w.owner_id=auth.uid();
 if ws is null or p_repo is null or p_repo !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$' or p_sha is null or p_sha !~ '^[a-f0-9]{40}$' or p_brief is null or length(btrim(p_brief)) not between 1 and 8000 or p_deadline is null or p_deadline<=now() or p_deadline>now()+interval '30 minutes' then raise exception 'invalid owner task';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request::text,0));
 select id into result from t3_owner_tasks where owner_id=auth.uid() and request_id=p_request;
 if result is not null then
 if not exists(select 1 from t3_owner_tasks where id=result and project_id=p_project and repo_key=p_repo and base_sha=p_sha and brief=p_brief and cleanup_deadline=p_deadline)then raise exception 'request conflict';end if;return result;end if;
 insert into t3_owner_tasks(owner_id,request_id,workspace_id,project_id,repo_key,base_sha,brief,cleanup_deadline)values(auth.uid(),p_request,ws,p_project,p_repo,p_sha,p_brief,p_deadline)returning id into result;return result;
end $$;
revoke all on function public.submit_t3_owner_task(uuid,uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.submit_t3_owner_task(uuid,uuid,text,text,text,timestamptz) to authenticated;
create function public.claim_t3_owner_task(p_id uuid,p_worker text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t t3_owner_tasks%rowtype;
begin
 if p_worker is null or p_worker !~ '^t3:[a-zA-Z0-9_-]{1,64}$' then raise exception 'invalid worker';end if;
 select * into t from t3_owner_tasks where id=p_id for update;
 if not found or t.phase<>'queued' or t.cleanup_deadline<=now() then return null;end if;
 update t3_owner_tasks set phase='provisioning',version=version+1,worker=p_worker,lease_until=least(now()+interval '3 minutes',cleanup_deadline),updated_at=now()where id=p_id returning * into t;return to_jsonb(t);
end $$;
revoke all on function public.claim_t3_owner_task(uuid,text) from public,anon,authenticated;
grant execute on function public.claim_t3_owner_task(uuid,text) to service_role;
create function public.advance_t3_owner_task(p_id uuid,p_version int,p_worker text,p_next text,p_patch jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare t t3_owner_tasks%rowtype;
begin
 select * into t from t3_owner_tasks where id=p_id for update;
 if not found or t.version is distinct from p_version or t.worker is distinct from p_worker then raise exception 'stale task binding';end if;
 if p_next not in ('cleanup_due','deleted') and (t.lease_until<=now() or t.cleanup_deadline<=now())then raise exception 'lease expired';end if;
 if not ((t.phase='provisioning' and p_next in ('ready','uncertain','cleanup_due'))or(t.phase='ready' and p_next in ('launching','cleanup_due'))or(t.phase='launching' and p_next in ('launched','uncertain','cleanup_due'))or(t.phase='launched' and p_next in ('review_required','uncertain','cleanup_due'))or(t.phase in ('review_required','uncertain')and p_next='cleanup_due')or(t.phase='cleanup_due' and p_next='deleted'))then raise exception 'invalid transition';end if;
 if exists(select 1 from jsonb_object_keys(p_patch)k where k not in ('execution_id','thread_id','run_id','artifact'))then raise exception 'immutable mapping';end if;
 if p_patch ? 'execution_id' and (t.phase<>'provisioning' or p_next<>'ready' or coalesce(p_patch->>'execution_id','') !~ '^[a-z0-9]{1,64}$')then raise exception 'invalid execution mapping';end if;
 if p_next='ready' and not p_patch ? 'execution_id' then raise exception 'execution required';end if;
 if (p_patch ? 'thread_id' or p_patch ? 'run_id') and (p_next<>'launched' or t.phase<>'launching')then raise exception 'immutable run mapping';end if;
 if p_next='launched' and(length(coalesce(p_patch->>'thread_id',''))not between 1 and 256 or length(coalesce(p_patch->>'run_id',''))not between 1 and 512)then raise exception 'run correlation required';end if;
 if p_patch ? 'artifact'and p_next<>'review_required' then raise exception 'result phase required';end if;
 if p_next='review_required' and((p_patch->'artifact'->>'taskId')is distinct from t.id::text or (p_patch->'artifact'->>'executionId')is distinct from t.execution_id or (p_patch->'artifact'->>'threadId')is distinct from t.thread_id or (p_patch->'artifact'->>'runId')is distinct from t.run_id or jsonb_typeof(p_patch->'artifact')is distinct from 'object' or octet_length((p_patch->'artifact')::text)>200000 or (p_patch->'artifact'->>'trusted')is distinct from 'false' or (p_patch->'artifact'->>'reviewRequired')is distinct from 'true' or jsonb_typeof(p_patch->'artifact'->'messages')is distinct from 'array')then raise exception 'bounded result required';end if;
 update t3_owner_tasks set phase=p_next,result_outcome=case when p_next='review_required' then 'review_required' when p_next='uncertain' then 'uncertain' when p_next='cleanup_due' and result_outcome is null then 'failed_or_uncertain' else result_outcome end,version=version+1,
 execution_id=coalesce(p_patch->>'execution_id',execution_id),thread_id=coalesce(p_patch->>'thread_id',thread_id),run_id=coalesce(p_patch->>'run_id',run_id),
 artifact=coalesce(p_patch->'artifact',artifact),artifact_sha256=case when p_patch ? 'artifact' then encode(sha256(convert_to((p_patch->'artifact')::text,'UTF8')),'hex') else artifact_sha256 end,
 lease_until=least(now()+interval '3 minutes',cleanup_deadline),updated_at=now()where id=p_id returning * into t;return to_jsonb(t);
end $$;
revoke all on function public.advance_t3_owner_task(uuid,int,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.advance_t3_owner_task(uuid,int,text,text,jsonb) to service_role;
-- Separate watchdog can take ONLY cleanup responsibility after lease/deadline.
create function public.take_t3_cleanup(p_id uuid,p_worker text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare t t3_owner_tasks%rowtype;
begin
 if p_worker is null or p_worker !~ '^t3:[a-zA-Z0-9_-]{1,64}$'then raise exception 'invalid worker';end if;
 select * into t from t3_owner_tasks where id=p_id for update;
 if not found or t.phase='deleted' or(t.phase='cleanup_due' and t.lease_until>now()) or(t.phase<>'cleanup_due' and t.cleanup_deadline>now()and coalesce(t.lease_until,t.cleanup_deadline)>now())then return null;end if;
 update t3_owner_tasks set phase='cleanup_due',worker=p_worker,version=version+1,lease_until=now()+interval '3 minutes',updated_at=now()where id=p_id returning * into t;return to_jsonb(t);
end $$;
revoke all on function public.take_t3_cleanup(uuid,text) from public,anon,authenticated;
grant execute on function public.take_t3_cleanup(uuid,text) to service_role;
create function public.heartbeat_t3_task(p_id uuid,p_version int,p_worker text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 update t3_owner_tasks set lease_until=least(now()+interval '3 minutes',cleanup_deadline),updated_at=now()
 where id=p_id and version=p_version and worker=p_worker and lease_until>now()and cleanup_deadline>now()and phase not in('deleted','cleanup_due');return found;
end $$;
revoke all on function public.heartbeat_t3_task(uuid,int,text) from public,anon,authenticated;
grant execute on function public.heartbeat_t3_task(uuid,int,text) to service_role;
