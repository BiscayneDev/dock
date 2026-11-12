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
 input text not null check(length(input) between 1 and 32000),
 state text not null default 'queued' check(state in('queued','leased','started','done','failed','uncertain')),
 epoch int not null default 0,
 worker text,
 lease_expires_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.mobile_task_jobs enable row level security;
revoke all on public.mobile_task_jobs from anon,authenticated;
create or replace function public.mobile_job_enqueue(p_task uuid,p_owner uuid,p_input text)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if not exists(select 1 from public.mobile_tasks where id=p_task and owner_id=p_owner)then return false;end if;
 insert into public.mobile_task_jobs(task_id,owner_id,input)values(p_task,p_owner,p_input)on conflict do nothing;
 get diagnostics n=row_count;
 if n=1 then perform public.mobile_task_transition(p_task,p_owner,'delegated','system');end if;
 return n=1;
end $$;
-- Lease the next job. Reaps lost STARTED jobs to 'uncertain' first (never re-leased, never replayed).
create or replace function public.mobile_job_lease(p_worker text,p_ttl_seconds int)returns jsonb language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;r record;
begin
 if p_ttl_seconds<1 or p_ttl_seconds>600 then return null;end if;
 for r in update public.mobile_task_jobs set state='uncertain',updated_at=now() where state='started' and lease_expires_at<now() returning task_id,owner_id loop
  perform public.mobile_task_transition(r.task_id,r.owner_id,'blocked','system');
 end loop;
 select * into j from public.mobile_task_jobs where state='queued' or(state='leased' and lease_expires_at<now())order by updated_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.mobile_task_jobs set state='leased',epoch=epoch+1,worker=p_worker,lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()where task_id=j.task_id returning * into j;
 return jsonb_build_object('task_id',j.task_id,'owner_id',j.owner_id,'epoch',j.epoch,'input',j.input);
end $$;
-- Start = the durable pre-send claim. True only for the current unexpired lease holder and only once per task.
create or replace function public.mobile_job_start(p_task uuid,p_worker text,p_epoch int)returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;
begin
 select * into j from public.mobile_task_jobs where task_id=p_task and state='leased' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 if not public.mobile_task_attempt(p_task,j.owner_id,'turn',true)then update public.mobile_task_jobs set state='uncertain',updated_at=now()where task_id=p_task;return false;end if;
 update public.mobile_task_jobs set state='started',updated_at=now()where task_id=p_task;
 perform public.mobile_task_transition(p_task,j.owner_id,'running','agent');
 return true;
end $$;
create or replace function public.mobile_job_heartbeat(p_task uuid,p_worker text,p_epoch int,p_ttl_seconds int)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if p_ttl_seconds<1 or p_ttl_seconds>600 then return false;end if;
 update public.mobile_task_jobs set lease_expires_at=now()+make_interval(secs=>p_ttl_seconds),updated_at=now()where task_id=p_task and state in('leased','started')and worker=p_worker and epoch=p_epoch and lease_expires_at>now();
 get diagnostics n=row_count;return n=1;
end $$;
-- Fenced finish: a result from an expired, reaped or superseded worker is rejected and writes nothing.
create or replace function public.mobile_job_finish(p_task uuid,p_worker text,p_epoch int,p_status text,p_digest text default null,p_summary text default null,p_evidence jsonb default '[]')returns boolean language plpgsql security definer set search_path=public as $$
declare j public.mobile_task_jobs;ok boolean;
begin
 if p_status not in('delivered','failed')then return false;end if;
 select * into j from public.mobile_task_jobs where task_id=p_task and state='started' and worker=p_worker and epoch=p_epoch and lease_expires_at>now()for update;
 if not found then return false;end if;
 ok:=public.mobile_task_finish(p_task,j.owner_id,'turn',p_status,p_digest,p_summary);
 if not ok then return false;end if;
 update public.mobile_task_jobs set state=case when p_status='delivered' then 'done' else 'failed' end,updated_at=now()where task_id=p_task;
 perform public.mobile_task_transition(p_task,j.owner_id,case when p_status='delivered' then 'done' else 'failed' end,'agent',case when p_status='delivered' then case when jsonb_array_length(coalesce(p_evidence,'[]'))>0 then p_evidence else jsonb_build_array('worker recorded completed turn') end else '[]'::jsonb end);
 return true;
end $$;
revoke all on function public.mobile_job_enqueue(uuid,uuid,text),public.mobile_job_lease(text,int),public.mobile_job_start(uuid,text,int),public.mobile_job_heartbeat(uuid,text,int,int),public.mobile_job_finish(uuid,text,int,text,text,text,jsonb) from public,anon,authenticated;
commit;
