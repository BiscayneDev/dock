-- Beta allowlist — chat guids permitted to bind identities during private beta.
-- When this table has rows, only listed guids may create new bindings.
-- When empty, binding is open (with a console warning) — populate before the
-- 10-seat beta opens. Halsey adds guids via the Supabase dashboard.

create table if not exists public.beta_allowlist (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null unique,
  added_at timestamptz not null default now(),
  note text
);

alter table public.beta_allowlist enable row level security;

-- Only service role can read or modify the allowlist.
create policy "Service role can manage allowlist"
  on public.beta_allowlist for all
  to service_role
  using (true)
  with check (true);
