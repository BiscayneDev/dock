-- DRAFT ONLY. Not applied anywhere real. Queued-worker memory: scoped recall before a job, idempotent private write-back after a verified success.
-- Identity (owner, workspace, project, agent, device) is derived on the server from the fenced job and its session, never from worker or task input.
-- Write-back is a PRIVATE agent note through beacon_mobile_note (migration 0020). It is never shared; promotion stays owner-only (beacon_promote).
create table public.mobile_task_memory(
 task_id uuid primary key references public.mobile_tasks(id),
 owner_id uuid not null,workspace_id uuid not null,epoch int not null,note_id uuid,created_at timestamptz not null default now()
);
alter table public.mobile_task_memory enable row level security;
revoke all on public.mobile_task_memory from anon,authenticated;
-- Recall for the job in hand. Only the current unexpired lease holder of a STARTED job, authenticated for the job's owner and workspace.
-- Returns recalled rows as DATA (untrusted context). An absent Beacon function means no memory, not an error.
create or replace function public.mobile_job_recall(p_task uuid,p_worker text,p_secret text,p_epoch int,p_query text)returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;s record;out jsonb:='[]';
begin
 select * into j from public.mobile_task_jobs where task_id=p_task and state='started' and worker=p_worker and epoch=p_epoch and lease_expires_at>now();
 if not found then return null;end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return null;end if;
 if to_regclass('public.mobile_sessions') is null or to_regprocedure('public.beacon_mobile_recall(uuid,uuid,uuid,uuid,text,text,integer)') is null then return jsonb_build_object('memory','[]'::jsonb,'repoKeys','[]'::jsonb);end if;
 execute 'select s.device_id,s.project_id,s.agent_key,s.repo_keys from public.mobile_sessions s join public.mobile_tasks t on t.session_id=s.id where t.id=$1 and s.owner_id=$2 and s.workspace_id=$3' into s using p_task,j.owner_id,j.workspace_id;
 if s is null then return jsonb_build_object('memory','[]'::jsonb,'repoKeys','[]'::jsonb);end if;
 execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',r.id,''content'',left(r.content,1000),''source'',r.source_reference)),''[]''::jsonb) from public.beacon_mobile_recall($1,$2,$3,$4,$5,$6,8) r' into out using s.device_id,j.owner_id,j.workspace_id,s.project_id,s.agent_key,left(coalesce(p_query,''),500);
 -- repoKeys come from the server-side session record (what the device grant opened), never from the job context or task text.
 return jsonb_build_object('memory',out,'repoKeys',to_jsonb(s.repo_keys));
end $$;
-- Write-back. Only for a task that finished 'delivered' through the fenced finish (a delivery row exists, task is done). Failed, blocked or uncertain
-- tasks never reach it. The note text is built here from what the finish recorded (only the worker's execution evidence lines; the result sentence is not copied),
-- never from planner output. Idempotent: one row per task, so racing calls and restarts write at most one note.
create or replace function public.mobile_job_remember(p_task uuid,p_worker text,p_secret text)returns boolean language plpgsql security definer set search_path=public as $$
declare a jsonb;t public.mobile_tasks;d public.mobile_task_deliveries;s record;nid uuid;txt text;got int;
begin
 a:=public.mobile_worker_auth(p_worker,p_secret);if a is null then return false;end if;
 select * into t from public.mobile_tasks where id=p_task and state='done' and owner_id=(a->>'o')::uuid;if not found then return false;end if;
 select * into d from public.mobile_task_deliveries where task_id=p_task and owner_id=t.owner_id and workspace_id=(a->>'w')::uuid;if not found then return false;end if;
 if to_regclass('public.mobile_sessions') is null or to_regprocedure('public.beacon_mobile_note(uuid,uuid,uuid,uuid,text,text,text)') is null then return false;end if;
 execute 'select s.device_id,s.project_id,s.agent_key from public.mobile_sessions s where s.id=$1 and s.owner_id=$2 and s.workspace_id=$3' into s using t.session_id,t.owner_id,d.workspace_id;if s is null then return false;end if;
 if not exists(select 1 from jsonb_array_elements_text(t.evidence)e where e<>'worker recorded completed turn')then return false;end if; -- the fallback line is not evidence
 insert into public.mobile_task_memory(task_id,owner_id,workspace_id,epoch)values(p_task,t.owner_id,d.workspace_id,d.epoch)on conflict do nothing;get diagnostics got=row_count;
 if got=0 then return false;end if; -- already remembered (or being remembered by a racing caller)
 txt:='Finished task. Evidence recorded by the worker from its own sandboxed runs: '||coalesce((select string_agg(e,'; ')from jsonb_array_elements_text(t.evidence)e),'none');
 execute 'select public.beacon_mobile_note($1,$2,$3,$4,$5,$6,$7)' into nid using s.device_id,t.owner_id,d.workspace_id,s.project_id,s.agent_key,left(txt,4000),'mobile-task:'||p_task;
 update public.mobile_task_memory set note_id=nid where task_id=p_task;return true;
exception when others then delete from public.mobile_task_memory where task_id=p_task and note_id is null;return false; -- a failed note leaves no marker, so a later call can retry
end $$;
-- Catch-up after a crash between finish and remember: the same authenticated worker scope remembers its done, delivered, not-yet-remembered tasks.
create or replace function public.mobile_job_remember_pending(p_worker text,p_secret text)returns int language plpgsql security definer set search_path=public as $$
declare a jsonb;r record;n int:=0;
begin
 a:=public.mobile_worker_auth(p_worker,p_secret);if a is null then return 0;end if;
 for r in select d.task_id from public.mobile_task_deliveries d join public.mobile_tasks t on t.id=d.task_id where t.state='done' and d.owner_id=(a->>'o')::uuid and d.workspace_id=(a->>'w')::uuid and not exists(select 1 from public.mobile_task_memory m where m.task_id=d.task_id)order by d.created_at limit 20 loop
  if public.mobile_job_remember(r.task_id,p_worker,p_secret)then n:=n+1;end if;
 end loop;return n;
end $$;
revoke all on function public.mobile_job_recall(uuid,text,text,int,text),public.mobile_job_remember(uuid,text,text),public.mobile_job_remember_pending(text,text)from public,anon,authenticated;
grant execute on function public.mobile_job_recall(uuid,text,text,int,text),public.mobile_job_remember(uuid,text,text),public.mobile_job_remember_pending(text,text)to service_role;
