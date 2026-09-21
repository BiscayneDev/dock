-- Lossless resume delivery: a delivery LEASE plus acknowledgement, so
-- resumed_at only becomes final after space.send() actually succeeded.
--
-- Previous behavior (lossy): resumed_at was set at claim time and the
-- message sat in an in-memory queue — a process restart before delivery
-- permanently lost the confirmation while the DB said "resumed".
--
-- New semantics:
--   delivery_claimed_at = now()   — atomic claim (lease) by a poller
--   resumed_at          = now()   — set ONLY after space.send() resolves
--   re-claim allowed when      — resumed_at IS NULL AND lease expired
--                                (delivery_claimed_at < now() - lease)
-- Crash between claim and send: the lease expires, another poll (same or
-- new process) re-claims and retries. Delivery is at-least-once, never lost.

alter table public.connect_tokens
  add column if not exists delivery_claimed_at timestamptz;

create index if not exists connect_tokens_resume_pending_idx
  on public.connect_tokens (chat_id)
  where platform = 'imessage'
    and completed_at is not null
    and resumed_at is null;
