-- Magic-link tokens are single-use: verifyMagicToken inserts the token's jti
-- here before issuing a session; a unique violation means the token was
-- already consumed and verification must fail. Rows are only needed until
-- token expiry (15 min) — the cleanup keeps the table tiny.

create table if not exists consumed_magic_tokens (
  jti text primary key,
  consumed_at timestamptz not null default now()
);

-- Server-only: no anon/authenticated access through PostgREST.
alter table consumed_magic_tokens enable row level security;
revoke all on consumed_magic_tokens from anon, authenticated, public;

-- opportunistic cleanup of rows older than a day
delete from consumed_magic_tokens where consumed_at < now() - interval '1 day';
