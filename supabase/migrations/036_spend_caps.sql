-- Spend caps: per-user daily USD limit on agent-initiated money movement.
-- Additive only.

create table if not exists spend_limits (
  user_id uuid primary key references public.users (id) on delete cascade,
  daily_usd numeric not null default 50,
  updated_at timestamptz not null default now()
);

alter table spend_limits enable row level security;

drop policy if exists "users read own spend limit" on spend_limits;
create policy "users read own spend limit"
  on spend_limits for select
  using (auth.uid() = user_id);

drop policy if exists "users update own spend limit" on spend_limits;
create policy "users update own spend limit"
  on spend_limits for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role (supabase client with service key) bypasses RLS automatically.
