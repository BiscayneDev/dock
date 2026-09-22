-- Spectrum (iMessage) identity binding + one-use connect tokens
-- Backward compatible: existing Telegram users are untouched.

-- Allow iMessage-bound users (no Telegram account).
alter table users alter column telegram_id drop not null;

-- ============================================
-- Spectrum identity binding: iMessage chat guid -> Dock user
-- handle = sender identifier (phone/email-style) captured from the message
-- when Photon provides one; chat_guid remains the stable join key.
-- ============================================
create table spectrum_identities (
  id uuid primary key default gen_random_uuid(),
  chat_guid text unique not null,
  handle text,
  user_id uuid references users(id) on delete cascade,
  bound_at timestamptz,
  created_at timestamptz default now()
);

-- ============================================
-- One-use connect tokens (signed link carried state)
-- token_hash = sha256(token) — the raw token never touches the DB.
--
-- Single use is enforced by ATOMIC CONDITIONAL UPDATES, not by an index:
-- Postgres serializes concurrent UPDATEs on the row, so exactly one caller
-- can match `.is('used_at', null)` (begin) and exactly one can match
-- `.is('claimed_at', null)` (callback claim). Index-level enforcement is
-- impossible here: the consume guard is the WHERE clause, not uniqueness.
-- Concurrency verification is covered by the vitest suite (sequential
-- double-consume rejection) — see PR #21 review notes; a multi-connection
-- integration test against Postgres is listed in the PR checklist.
--
-- State machine:
--   created → used_at set        (start: beginConnectByToken, atomic)
--   → claimed_at set             (callback: claimConnectByState, atomic)
--   → completed_at set           (after code exchange + live verification)
--   failure between claim and complete: claimed_at is CLEARED (release),
--   so the same consent round-trip can be retried within the TTL.
--   imessage resume: resumed_at set once per chat by the Spectrum poll.
-- ============================================
create table connect_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  platform text not null check (platform in ('telegram', 'imessage')),
  chat_id text not null,            -- telegram chat id (as text) or iMessage chat guid
  user_id uuid references users(id) on delete cascade,
  pending_request text,             -- original request to resume after connect
  used_at timestamptz,
  claimed_at timestamptz,           -- callback in progress (retryable)
  resumed_at timestamptz,
  oauth_state text unique,          -- set when the OAuth flow starts (consumed token)
  completed_at timestamptz,         -- set ONLY after tokens persisted + verified
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

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
