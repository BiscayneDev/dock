-- Spectrum (iMessage) identity binding + one-use connect tokens
-- Backward compatible: existing Telegram users are untouched.

-- Allow iMessage-bound users (no Telegram account).
alter table users alter column telegram_id drop not null;

-- ============================================
-- Spectrum identity binding: iMessage chat guid -> Dock user
-- ============================================
create table spectrum_identities (
  id uuid primary key default gen_random_uuid(),
  chat_guid text unique not null,
  user_id uuid references users(id) on delete cascade,
  bound_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- One-use connect tokens (signed link carried state)
-- token_hash = sha256(token) — the raw token never touches the DB.
-- Single use is enforced by the used_at guard in the partial unique index.
-- ============================================
create table connect_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  platform text not null check (platform in ('telegram', 'imessage')),
  chat_id text not null,            -- telegram chat id (as text) or iMessage chat guid
  user_id uuid references users(id) on delete cascade,
  pending_request text,             -- original request to resume after connect
  used_at timestamptz,
  resumed_at timestamptz,
  oauth_state text unique,          -- set when the OAuth flow starts (consumed token)
  completed_at timestamptz,         -- set after tokens persisted + verified
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- A token can be consumed at most once: only one row per token_hash may
-- have used_at set.
create unique index connect_tokens_single_use
  on connect_tokens (token_hash) where used_at is not null;

-- ============================================
-- Persistent Spectrum conversation history
-- (replaces the in-memory Map in src/spectrum/index.ts)
-- ============================================
create table spectrum_messages (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz default now()
);

create index spectrum_messages_chat_idx on spectrum_messages (chat_guid, created_at);
