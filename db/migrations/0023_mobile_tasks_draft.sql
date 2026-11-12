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
alter table public.mobile_tasks enable row level security;
alter table public.mobile_task_versions enable row level security;
alter table public.mobile_task_handoffs enable row level security;
revoke all on public.mobile_tasks,public.mobile_task_versions,public.mobile_task_handoffs from anon,authenticated;
revoke all on function public.mobile_task_transition(uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
commit;
