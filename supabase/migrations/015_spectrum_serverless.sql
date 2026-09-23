-- Serverless Spectrum: inbound dedupe + outbound retry queue.
-- Moves Dinghy off the VPS process: the webhook route and cron sweep are
-- stateless, so exactly-once inbound handling and at-least-once outbound
-- delivery both live in the database.

-- Dedupe on Spectrum message.id (delivery is at-least-once).
create table public.spectrum_inbound_dedupe (
  message_id text primary key,
  chat_guid text not null,
  received_at timestamptz not null default now()
);

alter table public.spectrum_inbound_dedupe enable row level security;

create policy "Service role manages inbound dedupe"
  on public.spectrum_inbound_dedupe for all
  to service_role using (true) with check (true);

-- Outbound retry queue. The webhook route enqueues a pending row before the
-- send attempt and marks it sent on success; the cron sweep re-claims rows
-- whose lease expired (crash/kill between enqueue and send) or whose backoff
-- elapsed (send failure). Same lease pattern as connect_tokens (#21).
create table public.spectrum_outbox (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null,
  kind text not null check (kind in ('reply', 'connect_link', 'error_notice')),
  text text not null,
  status text not null default 'pending' check (status in ('pending', 'sent')),
  attempts integer not null default 0,
  lease_claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index spectrum_outbox_pending_idx
  on public.spectrum_outbox (next_attempt_at)
  where status = 'pending';

alter table public.spectrum_outbox enable row level security;

create policy "Service role manages outbox"
  on public.spectrum_outbox for all
  to service_role using (true) with check (true);

-- Atomic lease claim: one sweep (or route) takes a batch, others skip it.
-- An expired lease is stealable, so a killed function never loses a send.
create or replace function public.claim_spectrum_outbox(lease_ms integer, batch_size integer)
returns setof public.spectrum_outbox
language sql
as $$
  update public.spectrum_outbox
  set lease_claimed_at = now(), attempts = attempts + 1
  where id in (
    select id from public.spectrum_outbox
    where status = 'pending'
      and next_attempt_at <= now()
      and (lease_claimed_at is null or lease_claimed_at < now() - (lease_ms || ' milliseconds')::interval)
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning *;
$$;
