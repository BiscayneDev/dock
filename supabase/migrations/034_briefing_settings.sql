-- 033: morning briefing opt-in (Workstream C, dinghy-delight).
-- Default-on for Google-connected users: no row means enabled and unmuted.
-- A row overrides the default. user_id is the app user (public.users), same
-- id space as spectrum_identities.user_id; auth.users is not used by Dinghy.
-- The digest footer tells users to reply
-- "mute mornings"; the webhook handler upserts `muted` here.

create table if not exists public.briefing_settings (
    user_id uuid primary key references public.users (id) on delete cascade,
    enabled boolean not null default true,
    muted boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.briefing_settings enable row level security;

drop policy if exists "users read own briefing settings" on public.briefing_settings;
create policy "users read own briefing settings"
    on public.briefing_settings for select
    using (auth.uid () = user_id);

drop policy if exists "users update own briefing settings" on public.briefing_settings;
create policy "users update own briefing settings"
    on public.briefing_settings for update
    using (auth.uid () = user_id);

drop policy if exists "users insert own briefing settings" on public.briefing_settings;
create policy "users insert own briefing settings"
    on public.briefing_settings for insert
    with check (auth.uid () = user_id);
