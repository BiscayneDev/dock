-- DRAFT ONLY. Not applied anywhere. Durable job queue with fenced worker leases for phone tasks.
-- Needs 0023. No function here grants execution, spend or approval; a job only carries one task's input.
-- Fencing: every worker write needs (worker, epoch, unexpired lease) checked by the database clock.
-- A job that was STARTED (the single no-retry claim was taken before send) and then lost its worker is
-- never re-leased: it becomes 'uncertain' and the task 'blocked' for a human. Only provably unstarted
-- (leased, never started) or queued jobs are re-leased.
begin;
create table public.mobile_task_jobs(
 task_id uuid primary key references public.mobile_tasks(id),
 owner_id uuid not null,
 workspace_id uuid,
 input text not null check(length(input) between 1 and 32000),
 state text not null default 'queued' check(state in('queued','leased','started','done','failed','uncertain')),
 epoch int not null default 0,
 worker text,
 lease_expires_at timestamptz,
 context jsonb not null default '{}',
 updated_at timestamptz not null default now()
);
-- A worker exists only if the backend registered it for ONE owner+workspace with a secret (stored hashed). Every worker
-- call authenticates with that secret; owner and workspace are read from the registration, never asserted by the caller.
-- Registration is a backend-only function (an owner-authorized action in a real deployment).
create table public.mobile_workers(worker text primary key,owner_id uuid not null,workspace_id uuid not null,secret_hash text not null,last_seen timestamptz);
-- Result delivery: exactly one conversation message per task, bound to owner, workspace, session, task and the lease epoch
-- that finished it. Append-only: nothing here updates or replaces an existing message.
create table public.mobile_task_deliveries(
 task_id uuid primary key references public.mobile_tasks(id),
 owner_id uuid not null,workspace_id uuid not null,session_id uuid not null,epoch int not null,
 message_id uuid not null,created_at timestamptz not null default now()
);
alter table public.mobile_task_deliveries enable row level security;
revoke all on public.mobile_task_deliveries from anon,authenticated;
alter table public.mobile_workers enable row level security;
revoke all on public.mobile_workers from anon,authenticated;
alter table public.mobile_task_jobs enable row level security;
revoke all on public.mobile_task_jobs from anon,authenticated;
create or replace function public.mobile_worker_register(p_worker text,p_owner uuid,p_workspace uuid,p_secret text)returns boolean language plpgsql security definer set search_path=public as $$
begin
 if length(p_worker) not between 1 and 80 or length(coalesce(p_secret,''))<32 then return false;end if;
 insert into public.mobile_workers(worker,owner_id,workspace_id,secret_hash)values(p_worker,p_owner,p_workspace,encode(sha256(convert_to(p_secret,'UTF8')),'hex'))on conflict do nothing;
 return found;
end $$;
create or replace function public.mobile_worker_auth(p_worker text,p_secret text)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('o',owner_id,'w',workspace_id)from public.mobile_workers where worker=p_worker and secret_hash=encode(sha256(convert_to(coalesce(p_secret,''),'UTF8')),'hex')
$$;
create or replace function public.mobile_job_enqueue(p_task uuid,p_owner uuid,p_input text,p_context jsonb default '{}')returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if not exists(select 1 from public.mobile_tasks where id=p_task and owner_id=p_owner)then return false;end if;
 insert into public.mobile_task_jobs(task_id,owner_id,workspace_id,input,context)select p_task,p_owner,t.workspace_id,p_input,coalesce(p_context,'{}') from public.mobile_tasks t where t.id=p_task and t.owner_id=p_owner on conflict do nothing;
 get diagnostics n=row_count;
 if n=1 then perform public.mobile_task_transition(p_task,p_owner,'delegated','system');end if;
 return n=1;
end $$;
-- Lease the next job. Reaps lost STARTED jobs to 'uncertain' first (never re-leased, never replayed).
create or replace function public.mobile_job_lease(p_worker text,p_secret text,p_ttl_seconds int)returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;r record;a jsonb;
begin
 a:=public.mobile_worker_auth(p_worker,p_secret);
 if a is null or p_ttl_seconds<1 or p_ttl_seconds>600 then return null;end if; -- unauthenticated or unregistered workers lease nothing
 update public.mobile_workers set last_seen=now() where worker=p_worker;
 for r in update public.mobile_task_jobs set state='uncertain',updated_at=now() where state='started' and lease_expires_at<now() returning task_id,owner_id loop
  perform public.mobile_task_transition(r.task_id,r.owner_id,'blocked','system');
 end loop;
 select * into j from public.mobile_task_jobs where (state='queued' or(state='leased' and lease_expires_at<now()))and owner_id=(a->>'o')::uuid and workspace_id=(a->>'w')::uuid order by updated_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.mobile_task_jobs set state='leased',epoch=epoch+1,worker=p_worker,lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()where task_id=j.task_id returning * into j;
 return jsonb_build_object('task_id',j.task_id,'owner_id',j.owner_id,'epoch',j.epoch,'input',j.input,'context',j.context);
end $$;
-- Start = the durable pre-send claim. True only for the current unexpired lease holder and only once per task.
create or replace function public.mobile_job_start(p_task uuid,p_worker text,p_secret text,p_epoch int)returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;
begin
 select * into j from public.mobile_task_jobs where task_id=p_task and state='leased' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return false;end if;
 if not public.mobile_task_attempt(p_task,j.owner_id,'turn',true)then update public.mobile_task_jobs set state='uncertain',updated_at=now()where task_id=p_task;return false;end if;
 update public.mobile_task_jobs set state='started',updated_at=now()where task_id=p_task;
 perform public.mobile_task_transition(p_task,j.owner_id,'running','agent');
 return true;
end $$;
create or replace function public.mobile_job_heartbeat(p_task uuid,p_worker text,p_secret text,p_epoch int,p_ttl_seconds int)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if p_ttl_seconds<1 or p_ttl_seconds>600 then return false;end if;
 update public.mobile_task_jobs set lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()where task_id=p_task and public.mobile_worker_auth(p_worker,p_secret) is not distinct from jsonb_build_object('o',owner_id,'w',workspace_id) and state in('leased','started')and worker=p_worker and epoch=p_epoch and lease_expires_at>now();
 get diagnostics n=row_count;return n=1;
end $$;
-- Fenced finish: a result from an expired, reaped or superseded worker is rejected and writes nothing.
create or replace function public.mobile_job_finish(p_task uuid,p_worker text,p_secret text,p_epoch int,p_status text,p_digest text default null,p_summary text default null,p_evidence jsonb default '[]')returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;ok boolean;conv uuid;mid uuid;sess uuid;ws uuid;
begin
 if p_status not in('delivered','failed')then return false;end if;
 select * into j from public.mobile_task_jobs where task_id=p_task and state='started' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 if public.mobile_worker_auth(p_worker,p_secret) is distinct from jsonb_build_object('o',j.owner_id,'w',j.workspace_id) then return false;end if;
 ok:=public.mobile_task_finish(p_task,j.owner_id,'turn',p_status,p_digest,p_summary);
 if not ok then return false;end if;
 update public.mobile_task_jobs set state=case when p_status='delivered' then 'done' else 'failed' end,updated_at=now()where task_id=p_task;
 -- Same transaction as the fenced finish: if the message cannot be written, the whole finish rolls back.
 if p_status='delivered' and p_summary is not null and to_regclass('public.mobile_sessions') is not null and to_regclass('public.messages') is not null then
  select t.session_id,t.workspace_id into sess,ws from public.mobile_tasks t where t.id=p_task and t.owner_id=j.owner_id;
  execute 'select conversation_id from public.mobile_sessions where id=$1 and owner_id=$2 and workspace_id=$3' into conv using sess,j.owner_id,ws;
  if conv is not null then
   execute 'insert into public.messages(conversation_id,role,content,agent,meta)values($1,''agent'',$2,(select agent_key from public.mobile_tasks where id=$3),jsonb_build_object(''mobileTaskId'',$3,''executionEpoch'',$4,''source'',''queued-worker''))returning id' into mid using conv,left(p_summary,500),p_task,p_epoch;
   insert into public.mobile_task_deliveries(task_id,owner_id,workspace_id,session_id,epoch,message_id)values(p_task,j.owner_id,ws,sess,p_epoch,mid);
  end if;
 end if;
 perform public.mobile_task_transition(p_task,j.owner_id,case when p_status='delivered' then 'done' else 'failed' end,'agent',case when p_status='delivered' then case when jsonb_array_length(coalesce(p_evidence,'[]'))>0 then p_evidence else jsonb_build_array('worker recorded completed turn') end else '[]'::jsonb end);
 return true;
end $$;
-- Read-only status/result for ONE task, only for its owner and its own session. Pure read: repeated
-- delivery returns the same result and writes nothing, so a result is never duplicated or applied twice.
create or replace function public.mobile_job_status(p_task uuid,p_owner uuid,p_session uuid)returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('status',case j.state when 'queued' then 'queued' when 'leased' then 'queued' when 'started' then 'working' when 'done' then 'done' when 'failed' then 'failed' else 'uncertain' end,
  'summary',case when j.state='done' then t.result_summary end,'evidence',case when j.state='done' then t.evidence end)
 from public.mobile_task_jobs j join public.mobile_tasks t on t.id=j.task_id where j.task_id=p_task and t.owner_id=p_owner and j.owner_id=p_owner and t.session_id=p_session;
$$;
create or replace function public.mobile_worker_beat(p_worker text,p_secret text)returns boolean language plpgsql security definer set search_path=public as $$
begin
 if public.mobile_worker_auth(p_worker,p_secret) is null then return false;end if;
 update public.mobile_workers set last_seen=now() where worker=p_worker;return true;
end $$;
create or replace function public.mobile_worker_last_seen(p_owner uuid,p_workspace uuid)returns timestamptz language sql stable security definer set search_path=public as $$select max(last_seen)from public.mobile_workers where owner_id=p_owner and workspace_id=p_workspace$$;
revoke all on function public.mobile_job_status(uuid,uuid,uuid),public.mobile_worker_beat(text,text),public.mobile_worker_register(text,uuid,uuid,text),public.mobile_worker_auth(text,text),public.mobile_worker_last_seen(uuid,uuid) from public,anon,authenticated;
revoke all on function public.mobile_job_enqueue(uuid,uuid,text,jsonb),public.mobile_job_lease(text,text,int),public.mobile_job_start(uuid,text,text,int),public.mobile_job_heartbeat(uuid,text,text,int,int),public.mobile_job_finish(uuid,text,text,int,text,text,text,jsonb) from public,anon,authenticated;
commit;
