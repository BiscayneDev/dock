-- DRAFT ONLY, no issued tokens. Scope one execution; never owner credentials.
begin;
create table public.mobile_execution_capabilities(id uuid primary key default gen_random_uuid(),execution_id uuid not null references mobile_executions(id),secret_hash text not null check(secret_hash~'^[a-f0-9]{64}$'),expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now());
alter table public.mobile_execution_capabilities enable row level security;
revoke all on public.mobile_execution_capabilities from anon,authenticated;
commit;
