-- Dinghy durable facts: global key-value context injected into the system
-- prompt on every message, so a thin-history chat never reads as a total
-- stranger. Seeded with the product basics (2026-09-22).

create table if not exists public.dinghy_facts (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

alter table public.dinghy_facts enable row level security;
-- No policies: only the service role (which bypasses RLS) reads or writes.

insert into public.dinghy_facts (key, value) values
    ('owner', 'Halsey'),
    ('product', 'Dinghy'),
    ('line', '+1 (628) 264-7754'),
    ('stack', 'serverless on Vercel + Supabase')
on conflict (key) do update set value = excluded.value, updated_at = now();
