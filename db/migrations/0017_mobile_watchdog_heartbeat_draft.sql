-- DRAFT ONLY. Deploy scheduler and external missed-heartbeat alerting separately.
begin;
create table public.mobile_maintenance_heartbeats(id bigint generated always as identity primary key,worker_key text not null,at timestamptz not null default now(),details jsonb not null);
alter table public.mobile_maintenance_heartbeats enable row level security;
revoke all on public.mobile_maintenance_heartbeats from anon,authenticated;
commit;
