-- DRAFT ONLY. Not applied anywhere. Server-side task + handoff ledger for the phone surface.
-- State changes are bookkeeping; no column or function here grants execution, spend or approval.
begin;
create table public.mobile_tasks(
 id uuid primary key,
 owner_id uuid not null,
 workspace_id uuid not null,
 session_id uuid not null,
 agent_key text not null,
 review_policy text not null default 'none' check(review_policy in('none','owner')),
 state text not null default 'queued' check(state in('queued','delegated','running','blocked','waiting_on_you','ready_for_review','done','failed')),
 waiting_on text,
 evidence jsonb not null default '[]',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(state<>'waiting_on_you' or waiting_on is not null)
);
create table public.mobile_task_versions(
 task_id uuid not null references public.mobile_tasks(id),
 v int not null, brief text not null, actor text not null, created_at timestamptz not null default now(),
 primary key(task_id,v)
);
-- One handoff intent per (task,key). status is written by the backend only, before any send.
create table public.mobile_task_handoffs(
 task_id uuid not null references public.mobile_tasks(id),
 key text not null,
 no_retry boolean not null default true,
 status text not null default 'pending' check(status in('pending','uncertain','delivered','failed')),
 attempts int not null default 0,
 reply_digest text check(reply_digest is null or reply_digest ~ '^[a-f0-9]{64}$'),
 primary key(task_id,key)
);
create or replace function public.mobile_task_transition(p_task uuid,p_owner uuid,p_next text,p_actor text,p_evidence jsonb default '[]',p_waiting text default null)returns boolean language plpgsql security definer set search_path=public as $$
declare t public.mobile_tasks;ok boolean;
begin
 select * into t from public.mobile_tasks where id=p_task and owner_id=p_owner for update;
 if not found then return false;end if;
 ok:=(t.state,p_next) in(('queued','delegated'),('queued','failed'),('delegated','running'),('delegated','blocked'),('delegated','failed'),('running','blocked'),('running','waiting_on_you'),('running','ready_for_review'),('running','done'),('running','failed'),('blocked','delegated'),('blocked','waiting_on_you'),('blocked','failed'),('waiting_on_you','delegated'),('waiting_on_you','running'),('waiting_on_you','failed'),('ready_for_review','done'),('ready_for_review','delegated'),('ready_for_review','failed'),('failed','delegated'));
 if not ok then return false;end if;
 if p_next in('ready_for_review','done') and jsonb_array_length(t.evidence||coalesce(p_evidence,'[]'))=0 then return false;end if;
 if p_next='done' and t.review_policy='owner' and p_actor<>'owner' then return false;end if;
 if p_next='waiting_on_you' and p_waiting is null then return false;end if;
 update public.mobile_tasks set state=p_next,evidence=evidence||coalesce(p_evidence,'[]'),waiting_on=case when p_next='waiting_on_you' then p_waiting else null end,updated_at=now() where id=p_task;
 return true;
end $$;
-- Idempotent open: same id returns the existing row's state, never a second task.
create or replace function public.mobile_task_open(p_task uuid,p_owner uuid,p_workspace uuid,p_session uuid,p_agent text,p_review text,p_brief text)returns text language plpgsql security definer set search_path=public as $$
declare s text;
begin
 insert into public.mobile_tasks(id,owner_id,workspace_id,session_id,agent_key,review_policy)values(p_task,p_owner,p_workspace,p_session,p_agent,p_review)on conflict(id)do nothing;
 insert into public.mobile_task_versions(task_id,v,brief,actor)select p_task,1,p_brief,'owner' where exists(select 1 from public.mobile_tasks where id=p_task and owner_id=p_owner)on conflict do nothing;
 select state into s from public.mobile_tasks where id=p_task and owner_id=p_owner;
 return s;
end $$;
-- Durable single-attempt claim, written BEFORE any send. A restart cannot send again:
-- the claim is true only for the first attempt of a no_retry handoff.
create or replace function public.mobile_task_attempt(p_task uuid,p_owner uuid,p_key text,p_no_retry boolean default true)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if not exists(select 1 from public.mobile_tasks where id=p_task and owner_id=p_owner)then return false;end if;
 insert into public.mobile_task_handoffs(task_id,key,no_retry)values(p_task,p_key,p_no_retry)on conflict do nothing;
 update public.mobile_task_handoffs set status='uncertain',attempts=attempts+1 where task_id=p_task and key=p_key and status='pending' and (not no_retry or attempts=0);
 get diagnostics n=row_count;return n=1;
end $$;
-- Backend-only finish. delivered needs a backend-computed reply digest.
create or replace function public.mobile_task_finish(p_task uuid,p_owner uuid,p_key text,p_status text,p_digest text default null)returns boolean language plpgsql security definer set search_path=public as $$
declare n int;
begin
 if p_status not in('delivered','failed')or(p_status='delivered' and p_digest is null)then return false;end if;
 update public.mobile_task_handoffs h set status=p_status,reply_digest=p_digest from public.mobile_tasks t where h.task_id=p_task and h.key=p_key and t.id=h.task_id and t.owner_id=p_owner and h.status='uncertain';
 get diagnostics n=row_count;return n=1;
end $$;
alter table public.mobile_tasks enable row level security;
alter table public.mobile_task_versions enable row level security;
alter table public.mobile_task_handoffs enable row level security;
revoke all on public.mobile_tasks,public.mobile_task_versions,public.mobile_task_handoffs from anon,authenticated;
revoke all on function public.mobile_task_transition(uuid,uuid,text,text,jsonb,text),public.mobile_task_open(uuid,uuid,uuid,uuid,text,text,text),public.mobile_task_attempt(uuid,uuid,text,boolean),public.mobile_task_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
commit;
