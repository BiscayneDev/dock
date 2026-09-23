-- Knows-me pass, part 2 (Workstream F): day-1 interview state.
--
-- dinghy_interviews tracks, per chat, where the first-day conversation is:
--   0 none · 1 opener asked · 2 name question asked · 3 mornings question
--   asked · 4 done. The opener (dinghy.ts) fires on a genuinely new chat;
--   after its answer we ask at most TWO short follow-ups across separate
--   turns — what to call them, and what mornings should look like — skipping
--   whichever the person already answered. Answers become profile facts via
--   the normal extraction path.

create table if not exists public.dinghy_interviews (
  chat_guid text primary key,
  stage int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.dinghy_interviews enable row level security;
revoke all on public.dinghy_interviews from anon, authenticated, public;
