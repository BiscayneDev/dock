-- Shared spend ledger: one row per settled money movement across every rail
-- (paybox payments/swaps, wallet sends, x402 paid calls, recipe payments).
-- getDailySpend sums this table, so the daily cap covers all sources.
-- Additive only. FK points at public.users (the app's user ids), not auth.users.

create table if not exists spend_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source text not null check (source in ('paybox_payment','paybox_swap','wallet_send','x402','recipe')),
  amount_usd numeric not null,
  currency text,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists spend_events_user_created_idx
  on spend_events (user_id, created_at);

alter table spend_events enable row level security;

drop policy if exists "users read own spend events" on spend_events;
create policy "users read own spend events"
  on spend_events for select
  using (auth.uid() = user_id);

-- Writes go through the service-role client only (RLS bypassed by service role).
-- No insert/update/delete policies: users can read their ledger but never write it.
