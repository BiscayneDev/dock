-- DRAFT ONLY. Not applied anywhere real. Queued-worker memory: scoped recall before a job, idempotent private write-back after a verified success.
-- Identity (owner, workspace, project, agent, device) is derived on the server from the fenced job and its session, never from worker or task input.
-- Write-back is a PRIVATE agent note through beacon_mobile_note (migration 0020). It is never shared; promotion stays owner-only (beacon_promote).
alter table public.mobile_task_deliveries add column evidence_verified boolean not null default false; -- set only by the authenticated worker for evidence its own trusted code derived from sandboxed runs
create table public.mobile_task_memory(
 task_id uuid primary key references public.mobile_tasks(id),
 owner_id uuid not null,workspace_id uuid not null,epoch int not null,note_id uuid,created_at timestamptz not null default now()
);
alter table public.mobile_task_memory enable row level security;
revoke all on public.mobile_task_memory from anon,authenticated;
-- Is this job's session still authorized? Fails closed once the session tables exist (they always do in the real chain).
-- Without them there is no device concept (lab-only schemas), so there is nothing to revoke.
create or replace function public.mobile_job_authorized(p_task uuid)returns boolean language plpgsql stable security definer set search_path=public as $$
declare ok boolean;
begin
 if to_regclass('public.mobile_sessions') is null then return true;end if;
 execute 'select exists(select 1 from public.mobile_tasks t join public.mobile_sessions s on s.id=t.session_id and s.owner_id=t.owner_id and s.workspace_id=t.workspace_id join public.devices d on d.id=s.device_id and d.owner_id=s.owner_id and d.revoked_at is null join public.mobile_grants g on g.device_id=s.device_id and g.owner_id=s.owner_id and g.workspace_id=s.workspace_id and g.project_id is not distinct from s.project_id and g.agent_key=s.agent_key and g.revoked_at is null where t.id=$1)' into ok using p_task;
 return coalesce(ok,false);
end $$;
-- Heartbeat refuses (and stops extending the lease) once the grant is revoked, so the worker can cancel running work.
create or replace function public.mobile_job_heartbeat(p_task uuid,p_worker text,p_secret text,p_epoch int,p_ttl_seconds int)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if p_ttl_seconds<1 or p_ttl_seconds>600 then return false;end if;
 update public.mobile_task_jobs set lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()where task_id=p_task and public.mobile_worker_auth(p_worker,p_secret) is not distinct from jsonb_build_object('o',owner_id,'w',workspace_id) and state in('leased','started')and worker=p_worker and epoch=p_epoch and lease_expires_at>now()and public.mobile_job_authorized(p_task);
 get diagnostics n=row_count;return n=1;
end $$;
-- Start and finish now check it (replacing the 0024 definitions).
create or replace function public.mobile_job_start(p_task uuid,p_worker text,p_secret text,p_epoch int)returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;
begin
 select * into j from public.mobile_task_jobs where task_id=p_task and state='leased' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return false;end if;
 if not public.mobile_job_authorized(p_task)then
  -- Revoked or missing device grant: refuse BEFORE any attempt is recorded. Nothing ran, so this is a clean failure, not an uncertain one.
  update public.mobile_task_jobs set state='failed',updated_at=now()where task_id=p_task;
  perform public.mobile_task_transition(p_task,j.owner_id,'failed','system');return false;
 end if;
 if not public.mobile_task_attempt(p_task,j.owner_id,'turn',true)then update public.mobile_task_jobs set state='uncertain',updated_at=now()where task_id=p_task;return false;end if;
 update public.mobile_task_jobs set state='started',updated_at=now()where task_id=p_task;
 perform public.mobile_task_transition(p_task,j.owner_id,'running','agent');
 return true;
end $$;
drop function public.mobile_job_finish(uuid,text,text,int,text,text,text,jsonb);
create or replace function public.mobile_job_finish(p_task uuid,p_worker text,p_secret text,p_epoch int,p_status text,p_digest text default null,p_summary text default null,p_evidence jsonb default '[]',p_verified boolean default false)returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;ok boolean;conv uuid;mid uuid;sess uuid;ws uuid;
begin
 if p_status not in('delivered','failed')then return false;end if;
 select * into j from public.mobile_task_jobs where task_id=p_task and state='started' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return false;end if;
 -- Authorization is re-checked at delivery. If the device grant was revoked while the worker ran, nothing is delivered and no memory is written.
 if p_status='delivered' and not public.mobile_job_authorized(p_task)then p_status:='failed';p_summary:=null;p_evidence:='[]'::jsonb;p_verified:=false;end if;
 ok:=public.mobile_task_finish(p_task,j.owner_id,'turn',p_status,p_digest,p_summary);
 if not ok then return false;end if;
 update public.mobile_task_jobs set state=case when p_status='delivered' then 'done' else 'failed' end,updated_at=now()where task_id=p_task;
 -- Same transaction as the fenced finish: if the message cannot be written, the whole finish rolls back.
 if p_status='delivered' and p_summary is not null and to_regclass('public.mobile_sessions') is not null and to_regclass('public.messages') is not null then
  select t.session_id,t.workspace_id into sess,ws from public.mobile_tasks t where t.id=p_task and t.owner_id=j.owner_id;
  execute 'select conversation_id from public.mobile_sessions where id=$1 and owner_id=$2 and workspace_id=$3' into conv using sess,j.owner_id,ws;
  if conv is not null then
   execute 'insert into public.messages(conversation_id,role,content,agent,meta)values($1,''agent'',$2,(select agent_key from public.mobile_tasks where id=$3),jsonb_build_object(''mobileTaskId'',$3,''executionEpoch'',$4,''source'',''queued-worker''))returning id' into mid using conv,left(p_summary,500),p_task,p_epoch;
   insert into public.mobile_task_deliveries(task_id,owner_id,workspace_id,session_id,epoch,message_id,evidence_verified)values(p_task,j.owner_id,ws,sess,p_epoch,mid,coalesce(p_verified,false));
  end if;
 end if;
 perform public.mobile_task_transition(p_task,j.owner_id,case when p_status='delivered' then 'done' else 'failed' end,'agent',case when p_status='delivered' then case when jsonb_array_length(coalesce(p_evidence,'[]'))>0 then p_evidence else jsonb_build_array('worker recorded completed turn') end else '[]'::jsonb end);
 -- Private note in the SAME transaction as the delivery, in a subtransaction: if the note cannot be written the delivery still commits and the catch-up retries it.
 begin perform public.mobile_task_remember_core(p_task);exception when others then null;end;
 return true;
end $$;
-- Recall for the job in hand. Returns an explicit status, never a bare empty list for a denial:
--   {status:'denied',reason}     lease lost, bad worker auth, or the session's device/grant is not authorized (NO context, and the runner must not execute)
--   {status:'unavailable',...}   Beacon or session tables are not installed (visible, not pretended empty)
--   {status:'ok',memory:[...],repoKeys:[...]}   memory may legitimately be empty
-- Any database error propagates as an error; it is never turned into an empty result here.
create or replace function public.mobile_job_recall(p_task uuid,p_worker text,p_secret text,p_epoch int,p_query text)returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;s record;out jsonb;
begin
 select * into j from public.mobile_task_jobs where task_id=p_task and state='started' and worker=p_worker and epoch=p_epoch and lease_expires_at>now();
 if not found then return jsonb_build_object('status','denied','reason','lease');end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return jsonb_build_object('status','denied','reason','worker');end if;
 if to_regclass('public.mobile_sessions') is null or to_regprocedure('public.beacon_mobile_recall(uuid,uuid,uuid,uuid,text,text,integer)') is null then return jsonb_build_object('status','unavailable','reason','beacon-not-installed');end if;
 if not public.mobile_job_authorized(p_task)then return jsonb_build_object('status','denied','reason','grant');end if;
 execute 'select s.device_id,s.project_id,s.agent_key,s.repo_keys from public.mobile_sessions s join public.mobile_tasks t on t.session_id=s.id where t.id=$1 and s.owner_id=$2 and s.workspace_id=$3' into s using p_task,j.owner_id,j.workspace_id;
 if s.device_id is null then return jsonb_build_object('status','denied','reason','session');end if;
 execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',r.id,''content'',left(r.content,1000),''source'',r.source_reference)),''[]''::jsonb) from public.beacon_mobile_recall($1,$2,$3,$4,$5,$6,8) r' into out using s.device_id,j.owner_id,j.workspace_id,s.project_id,s.agent_key,left(coalesce(p_query,''),500);
 -- repoKeys come from the server-side session record (what the device grant opened), never from the job context or task text.
 return jsonb_build_object('status','ok','memory',out,'repoKeys',to_jsonb(s.repo_keys));
end $$;
-- Core write-back (no caller auth: only the fenced finish and the authenticated wrappers below reach it). Writes at most one PRIVATE agent note per task:
--   only for a task that is done through the fenced delivery, whose delivery row says the worker attested sandbox-derived evidence,
--   whose recorded evidence has a line other than the generic fallback, and whose session is still authorized.
-- The note text is built from the evidence lines only, never from the planner's result sentence.
create or replace function public.mobile_task_remember_core(p_task uuid)returns boolean language plpgsql security definer set search_path=public as $$
declare t public.mobile_tasks;d public.mobile_task_deliveries;s record;nid uuid;txt text;got int;
begin
 select * into t from public.mobile_tasks where id=p_task and state='done';if not found then return false;end if;
 select * into d from public.mobile_task_deliveries where task_id=p_task and owner_id=t.owner_id and evidence_verified;if not found then return false;end if;
 if not exists(select 1 from jsonb_array_elements_text(t.evidence)e where e<>'worker recorded completed turn')then return false;end if;
 if to_regclass('public.mobile_sessions') is null or to_regprocedure('public.beacon_mobile_note(uuid,uuid,uuid,uuid,text,text,text)') is null then return false;end if;
 if not public.mobile_job_authorized(p_task)then return false;end if;
 execute 'select s.device_id,s.project_id,s.agent_key from public.mobile_sessions s where s.id=$1 and s.owner_id=$2 and s.workspace_id=$3' into s using t.session_id,t.owner_id,d.workspace_id;if s.device_id is null then return false;end if;
 insert into public.mobile_task_memory(task_id,owner_id,workspace_id,epoch)values(p_task,t.owner_id,d.workspace_id,d.epoch)on conflict do nothing;get diagnostics got=row_count;
 if got=0 then return false;end if;
 txt:='Finished task. Evidence recorded by the worker from its own sandboxed runs: '||(select string_agg(e,'; ')from jsonb_array_elements_text(t.evidence)e);
 execute 'select public.beacon_mobile_note($1,$2,$3,$4,$5,$6,$7)' into nid using s.device_id,t.owner_id,d.workspace_id,s.project_id,s.agent_key,left(txt,4000),'mobile-task:'||p_task;
 update public.mobile_task_memory set note_id=nid where task_id=p_task;return true;
end $$;
-- Authenticated wrapper for the worker. True when the task has its note (written now or earlier), so a retry after a crash or a race is a no-op success.
create or replace function public.mobile_job_remember(p_task uuid,p_worker text,p_secret text)returns boolean language plpgsql security definer set search_path=public as $$
declare a jsonb;
begin
 a:=public.mobile_worker_auth(p_worker,p_secret);if a is null then return false;end if;
 if not exists(select 1 from public.mobile_task_deliveries where task_id=p_task and workspace_id=(a->>'w')::uuid and owner_id=(a->>'o')::uuid)then return false;end if;
 begin perform public.mobile_task_remember_core(p_task);exception when others then return false;end;
 return exists(select 1 from public.mobile_task_memory where task_id=p_task and note_id is not null);
end $$;
-- Catch-up after a crash between finish and note (also the retry path when the in-transaction note failed).
create or replace function public.mobile_job_remember_pending(p_worker text,p_secret text)returns int language plpgsql security definer set search_path=public as $$
declare a jsonb;r record;n int:=0;
begin
 a:=public.mobile_worker_auth(p_worker,p_secret);if a is null then return 0;end if;
 for r in select d.task_id from public.mobile_task_deliveries d join public.mobile_tasks t on t.id=d.task_id where t.state='done' and d.evidence_verified and d.owner_id=(a->>'o')::uuid and d.workspace_id=(a->>'w')::uuid and not exists(select 1 from public.mobile_task_memory m where m.task_id=d.task_id)order by d.created_at limit 20 loop
  begin if public.mobile_task_remember_core(r.task_id)then n:=n+1;end if;exception when others then null;end;
 end loop;return n;
end $$;
revoke all on function public.mobile_job_authorized(uuid),public.mobile_task_remember_core(uuid),public.mobile_job_recall(uuid,text,text,int,text),public.mobile_job_remember(uuid,text,text),public.mobile_job_remember_pending(text,text),public.mobile_job_start(uuid,text,text,int),public.mobile_job_heartbeat(uuid,text,text,int,int),public.mobile_job_finish(uuid,text,text,int,text,text,text,jsonb,boolean)from public,anon,authenticated;
grant execute on function public.mobile_job_recall(uuid,text,text,int,text),public.mobile_job_remember(uuid,text,text),public.mobile_job_remember_pending(text,text),public.mobile_job_start(uuid,text,text,int),public.mobile_job_finish(uuid,text,text,int,text,text,text,jsonb,boolean)to service_role;
