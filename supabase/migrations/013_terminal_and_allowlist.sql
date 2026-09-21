-- Add terminal_at column to connect_tokens for marking attempts where the
-- OAuth code was consumed but the flow failed (single-use codes can't retry).
-- Also add the beta_allowlist table for ownership gating during private beta.

alter table public.connect_tokens add column if not exists terminal_at timestamptz;

-- A terminal row can never be re-claimed or completed.
create index if not exists connect_tokens_terminal_idx
  on public.connect_tokens (terminal_at) where terminal_at is not null;
