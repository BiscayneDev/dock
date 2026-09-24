-- Workstream G: Dinghy's computer — persistent per-user E2B sandboxes,
-- metered per second into the shared spend ledger (spend_events).

-- 1. New ledger source: sandbox wall-clock metering.
alter table spend_events drop constraint spend_events_source_check;
alter table spend_events add constraint spend_events_source_check
  check (source in ('paybox_payment','paybox_swap','wallet_send','x402','recipe','sandbox'));

-- 2. One session row per user sandbox. status tracks the manager lifecycle;
-- killed_reason records why the server-side kill switch fired.
create table if not exists computer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  sandbox_id text,
  status text not null check (status in ('running','sleeping','killed','error')),
  started_at timestamptz,
  last_activity_at timestamptz,
  killed_reason text,
  created_at timestamptz not null default now()
);

create index if not exists computer_sessions_user_idx on computer_sessions (user_id, status);

alter table computer_sessions enable row level security;

drop policy if exists "users read own computer sessions" on computer_sessions;
create policy "users read own computer sessions"
  on computer_sessions for select
  using (auth.uid() = user_id);

-- 3. Per-user allowance settings. Defaults: 30 min free/day, $5 hard cap.
create table if not exists computer_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  free_seconds_per_day int not null default 1800,
  hard_cap_usd_per_day numeric not null default 5.00,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

alter table computer_settings enable row level security;

drop policy if exists "users read own computer settings" on computer_settings;
create policy "users read own computer settings"
  on computer_settings for select
  using (auth.uid() = user_id);

-- Writes (manager, sweeper) go through the service-role client only.
-- No insert/update/delete policies: users can read but never mutate their
-- own session rows or allowance — the kill switch is server-side only.
