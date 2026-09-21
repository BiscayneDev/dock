-- Dinghy waitlist — email capture for private beta
-- One row per email. Duplicate-safe via unique constraint on email.
-- `status` tracks where the signup is in the funnel:
--   'joined'  — initial signup
--   'invited' — sent an invitation
--   'active'  — onboarded and using the product

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'joined' check (status in ('joined', 'invited', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.waitlist enable row level security;

-- Public can insert (join the waitlist) but cannot read or update.
create policy "Anyone can join the waitlist"
  on public.waitlist for insert
  to anon, authenticated
  with check (true);

-- Only service role can read and update.
create policy "Service role can manage waitlist"
  on public.waitlist for all
  to service_role
  using (true)
  with check (true);
