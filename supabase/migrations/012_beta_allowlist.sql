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

-- Provisioning (run in Supabase SQL editor, or add rows here before applying):
-- Halsey's iMessage chat GUID(s) are read from the Mac mini running the
-- Spectrum process (its log prints `imessage ← <guid>` per inbound message),
-- then inserted as:
--
-- insert into public.beta_allowlist (chat_guid, note)
-- values ('iMessage;-;+1XXXXXXXXXX', 'Halsey — beta owner')
-- on conflict (chat_guid) do nothing;
--
-- Each of the 10 beta members gets one row with their guid + name in `note`.
-- The insert is intentionally commented out: a placeholder guid must never
-- ship active in a migration.
