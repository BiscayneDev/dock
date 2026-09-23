-- Self-serve private-beta onboarding for the iMessage line.
--
-- A stranger texts the line, gets told it's invite-only, texts an invite
-- code, and is allowlisted. Codes are stored hashed (sha256 hex), can be
-- multi-use with a cap, and expire. Failed guesses are counted per chat
-- and lock the chat out for a day after 5 misses (brute-force guard).
--
-- The waitlist is not used as the vetting key: /api/waitlist accepts any
-- email with no verification, so "your email is on the waitlist" proves
-- nothing about who is texting.
--
-- All access is through security-definer RPCs granted to service_role only.

alter table public.beta_allowlist add column if not exists role text not null default 'member';
do $$ begin
  alter table public.beta_allowlist add constraint beta_allowlist_role_chk check (role in ('owner', 'member'));
exception when duplicate_object then null; end $$;
alter table public.beta_allowlist add column if not exists invite_code_hash text;
create unique index if not exists beta_allowlist_chat_guid_key on public.beta_allowlist (chat_guid);

-- Halsey's existing row becomes the owner (can mint invites from iMessage).
update public.beta_allowlist set role = 'owner'
where chat_guid = 'any;-;+12035168398' and role <> 'owner';

create table if not exists public.beta_invites (
  code_hash text primary key,
  note text,
  max_uses int not null default 1 check (max_uses > 0),
  uses int not null default 0,
  expires_at timestamptz not null default now() + interval '30 days',
  created_by_chat text,
  created_at timestamptz not null default now()
);
alter table public.beta_invites enable row level security;
revoke all on public.beta_invites from anon, authenticated, public;

create table if not exists public.beta_gate (
  chat_guid text primary key,
  last_notice_at timestamptz,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.beta_gate enable row level security;
revoke all on public.beta_gate from anon, authenticated, public;

-- 'owner' | 'member' | null (not allowlisted)
create or replace function public.beta_role(p_chat_guid text) returns text
language sql stable security definer set search_path = public as $$
  select role from public.beta_allowlist where chat_guid = p_chat_guid limit 1;
$$;

-- Returns 'ok' | 'already' | 'invalid' | 'locked'.
create or replace function public.redeem_beta_invite(p_chat_guid text, p_code_hash text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_gate public.beta_gate%rowtype;
  v_hit int;
begin
  if exists (select 1 from public.beta_allowlist where chat_guid = p_chat_guid) then
    return 'already';
  end if;

  insert into public.beta_gate (chat_guid) values (p_chat_guid) on conflict (chat_guid) do nothing;
  select * into v_gate from public.beta_gate where chat_guid = p_chat_guid for update;
  if v_gate.locked_until is not null and v_gate.locked_until > now() then
    return 'locked';
  end if;

  update public.beta_invites
  set uses = uses + 1
  where code_hash = p_code_hash and uses < max_uses and expires_at > now();
  get diagnostics v_hit = row_count;

  if v_hit = 0 then
    update public.beta_gate
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 5 then now() + interval '24 hours' else locked_until end,
        updated_at = now()
    where chat_guid = p_chat_guid;
    return 'invalid';
  end if;

  insert into public.beta_allowlist (chat_guid, note, role, invite_code_hash)
  values (p_chat_guid, 'self-serve invite', 'member', p_code_hash)
  on conflict (chat_guid) do nothing;
  update public.beta_gate set failed_attempts = 0, locked_until = null, updated_at = now()
  where chat_guid = p_chat_guid;
  return 'ok';
end;
$$;

-- True when the gate notice should be sent now (at most once per 12h per
-- chat), and records it. Keeps strangers from getting a reply per message.
create or replace function public.claim_beta_gate_notice(p_chat_guid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.beta_gate (chat_guid, last_notice_at) values (p_chat_guid, now())
  on conflict (chat_guid) do update
    set last_notice_at = now(), updated_at = now()
    where beta_gate.last_notice_at is null or beta_gate.last_notice_at < now() - interval '12 hours';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- Owner-only invite minting. Returns false when the caller isn't the owner.
create or replace function public.create_beta_invite(
  p_owner_chat text, p_code_hash text, p_max_uses int, p_note text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select role from public.beta_allowlist where chat_guid = p_owner_chat), '') <> 'owner' then
    return false;
  end if;
  insert into public.beta_invites (code_hash, max_uses, note, created_by_chat)
  values (p_code_hash, greatest(1, least(coalesce(p_max_uses, 1), 100)), p_note, p_owner_chat);
  return true;
end;
$$;

revoke execute on function public.beta_role(text) from anon, authenticated, public;
revoke execute on function public.redeem_beta_invite(text, text) from anon, authenticated, public;
revoke execute on function public.claim_beta_gate_notice(text) from anon, authenticated, public;
revoke execute on function public.create_beta_invite(text, text, int, text) from anon, authenticated, public;
grant execute on function public.beta_role(text) to service_role;
grant execute on function public.redeem_beta_invite(text, text) to service_role;
grant execute on function public.claim_beta_gate_notice(text) to service_role;
grant execute on function public.create_beta_invite(text, text, int, text) to service_role;

notify pgrst, 'reload schema';
