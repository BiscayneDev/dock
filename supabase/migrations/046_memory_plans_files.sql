-- 046: memory phase 1 — plans (trips/events) and remembered files.
--
-- dinghy_plans   one row per trip/event the user told Dinghy about (or a
--                source confirmed): dates, places, people, bookings. Upcoming
--                rows are always in the prompt until ends_on passes.
-- dinghy_files   every document Dinghy made for the user: title, link, full
--                Markdown, so it can reopen and update its own files.
--
-- Both are user-level (bound chats only), soft-deleted via deleted_at, and
-- service-role only (RLS on, no grants), like dinghy_user_profiles (035).

create table if not exists public.dinghy_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chat_guid text,
  title text not null check (char_length(title) between 2 and 140),
  kind text not null default 'trip' check (kind in ('trip', 'event', 'other')),
  starts_on date,
  ends_on date,
  places text[] not null default '{}',
  people text[] not null default '{}',
  details text not null default '' check (char_length(details) <= 2000),
  source text not null default 'user' check (source in ('user', 'file', 'email', 'calendar', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists dinghy_plans_user_active on public.dinghy_plans (user_id, ends_on) where deleted_at is null;
alter table public.dinghy_plans enable row level security;
revoke all on public.dinghy_plans from anon, authenticated, public;

create table if not exists public.dinghy_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chat_guid text,
  title text not null,
  format text not null,
  url text,
  markdown text not null default '' check (char_length(markdown) <= 60000),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists dinghy_files_user_recent on public.dinghy_files (user_id, created_at desc) where deleted_at is null;
alter table public.dinghy_files enable row level security;
revoke all on public.dinghy_files from anon, authenticated, public;
