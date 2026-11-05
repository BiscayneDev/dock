-- DRAFT ONLY. Private controller ledger; never a task-writable spool marker.
begin;
create table public.mobile_mailbox_claims(
 execution_id uuid not null references public.mobile_executions(id),
 request_id uuid not null,
 instance_id text not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 claimed_at timestamptz not null default now(),
 primary key(execution_id,request_id)
);
alter table public.mobile_mailbox_claims enable row level security;
revoke all on public.mobile_mailbox_claims from anon,authenticated;
commit;
