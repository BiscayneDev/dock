-- One claim per user's local date, across cron retries and concurrent deployments.
create table if not exists public.dinghy_brief_delivery (
  user_id uuid not null references public.users(id) on delete cascade,
  local_day date not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, local_day)
);
alter table public.dinghy_brief_delivery enable row level security;
revoke all on public.dinghy_brief_delivery from anon, authenticated;
