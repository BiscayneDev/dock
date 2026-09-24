-- Morning brief as a designed card, with weather where the person is.
--
-- user_locations: the last location a person shared into their Dinghy
-- thread (iMessage "Send My Current Location" / a maps pin). The briefing
-- uses it while fresh; otherwise it falls back to briefing_settings.home_place.
-- One row per user, overwritten on each share. Server-only.

create table if not exists public.user_locations (
  user_id uuid primary key references public.users (id) on delete cascade,
  lat double precision not null,
  lon double precision not null,
  label text,
  source text not null default 'imessage_pin',
  observed_at timestamptz not null default now()
);
alter table public.user_locations enable row level security;
revoke all on public.user_locations from anon, authenticated, public;
grant select, insert, update, delete on public.user_locations to service_role;

-- Home fallback for weather, e.g. 'Miami, FL'. Null = no weather unless a fresh pin exists.
alter table public.briefing_settings add column if not exists home_place text;

-- Outbox rows for the brief card: text holds JSON {card, text}; the sweep
-- renders the card and falls back to the plain text if rendering fails.
alter table public.spectrum_outbox drop constraint if exists spectrum_outbox_kind_check;
alter table public.spectrum_outbox
  add constraint spectrum_outbox_kind_check
  check (kind in ('reply', 'connect_link', 'error_notice', 'file', 'reminder', 'brief'));

notify pgrst, 'reload schema';
