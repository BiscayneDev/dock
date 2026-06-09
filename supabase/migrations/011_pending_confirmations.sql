-- Cross-invocation store for sensitive-action confirmations.
-- The previous in-memory Map could not work on serverless: the Telegram button
-- callback runs in a different invocation than the agent loop awaiting it, so
-- confirmations (wallet_send, gmail_send, Paybox approvals) always timed out.
-- The loop now inserts a row, polls it, and the callback handler flips status.
-- Service-role only (no policies) — accessed solely server-side.
create table if not exists pending_confirmations (
  action_id text primary key,
  user_id uuid references users(id) on delete cascade,
  chat_id bigint not null,
  tool_name text not null,
  tool_input jsonb,
  status text not null default 'pending',   -- pending | confirmed | cancelled
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_pending_confirmations_status
  on pending_confirmations(status, created_at);

alter table pending_confirmations enable row level security;
