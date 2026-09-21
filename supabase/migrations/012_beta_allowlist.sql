-- Beta allowlist — chat guids permitted to bind identities during private beta.
-- The table starts EMPTY — binding is CLOSED until Halsey provisions guids
-- operationally from the trusted live Spectrum identity/message record.
-- No open fallback, no placeholder seed. Test GUIDs only in test fixtures.

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
