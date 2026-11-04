-- Mobile pairing: expiring single-use codes + revocable device credentials.
-- The exchange is transactional (row lock + insert in one function) so a code
-- can never mint two device credentials, and failed guesses are bounded per
-- workspace per window at the database, not in app memory.
-- Access: service role only (RLS on, no policies -> anon/authed get nothing).

create table if not exists mobile_pairings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  code_hash text not null,
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists mobile_pairings_lookup on mobile_pairings (workspace_id, code_hash);

create table if not exists mobile_pairing_failures (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  failed_at timestamptz not null default now()
);
create index if not exists mobile_pairing_failures_window on mobile_pairing_failures (workspace_id, failed_at);

create table if not exists mobile_devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token_hash text not null unique,
  platform text not null,
  device_label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table mobile_pairings enable row level security;
alter table mobile_pairing_failures enable row level security;
alter table mobile_devices enable row level security;

-- Atomically consume a pairing code. Returns 'ok' | 'invalid' | 'rate_limited'.
-- 'ok' marks the code used inside the same transaction, so concurrent exchanges
-- of one code produce exactly one winner; the loser reads used = true.
create or replace function exchange_mobile_pairing(
  p_workspace_id uuid,
  p_code_hash text,
  p_max_failures integer,
  p_window_ms bigint
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_failures integer;
  v_row mobile_pairings%rowtype;
begin
  select count(*) into v_failures
    from mobile_pairing_failures
   where workspace_id = p_workspace_id
     and failed_at > now() - (p_window_ms * interval '1 millisecond');
  if v_failures >= p_max_failures then
    return 'rate_limited';
  end if;

  select * into v_row
    from mobile_pairings
   where workspace_id = p_workspace_id
     and code_hash = p_code_hash
   order by created_at desc
   limit 1
   for update;

  if not found or v_row.used or v_row.expires_at < now() then
    insert into mobile_pairing_failures (workspace_id) values (p_workspace_id);
    return 'invalid';
  end if;

  update mobile_pairings set used = true where id = v_row.id;
  return 'ok';
end;
$$;
