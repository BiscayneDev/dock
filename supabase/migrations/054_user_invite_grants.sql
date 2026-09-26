-- Per-user invite grants.
--
-- Members earn nothing by default: the admin (or the owner from iMessage)
-- grants each allowlisted chat N invites. The member texts Dinghy "invite"
-- to mint a shareable link (an entry in beta_invites created by their chat);
-- every redemption of their codes burns one grant. Remaining = granted -
-- sum(uses) across their codes. Owner-minted codes keep working exactly as
-- before (created_by_chat = owner chat, no grant row needed).
--
-- All access is through security-definer RPCs granted to service_role only.

create table if not exists public.user_invite_grants (
  chat_guid text primary key references public.beta_allowlist(chat_guid) on delete cascade,
  granted int not null default 0 check (granted >= 0 and granted <= 1000),
  updated_at timestamptz not null default now()
);
alter table public.user_invite_grants enable row level security;
revoke all on public.user_invite_grants from anon, authenticated, public;

-- Remaining invites for a chat: granted minus redemptions of its codes.
create or replace function public.user_invite_remaining(p_chat_guid text)
returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select granted from user_invite_grants where chat_guid = p_chat_guid), 0)
       - coalesce((select sum(uses) from beta_invites where created_by_chat = p_chat_guid), 0);
$$;

-- A member mints one link code. Returns the remaining balance after the
-- mint, or -1 when the chat has fewer invites left than requested. The
-- plaintext code never touches the database (p_code_hash is sha256 hex).
create or replace function public.mint_user_invite(
  p_chat_guid text, p_code_hash text, p_uses int, p_note text
)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_remaining int;
begin
  if not exists (select 1 from beta_allowlist where chat_guid = p_chat_guid) then
    return -1;
  end if;
  select user_invite_remaining(p_chat_guid) into v_remaining;
  if v_remaining < greatest(1, coalesce(p_uses, 1)) then
    return -1;
  end if;
  insert into beta_invites (code_hash, max_uses, note, created_by_chat)
  values (p_code_hash, greatest(1, least(coalesce(p_uses, 1), 100)), p_note, p_chat_guid);
  return v_remaining - greatest(1, coalesce(p_uses, 1));
end;
$$;

-- Admin/top-up path: add N invites to a chat's grant (creates the row).
create or replace function public.add_user_invite_grant(p_chat_guid text, p_amount int)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_granted int;
begin
  if not exists (select 1 from beta_allowlist where chat_guid = p_chat_guid) then
    return -1;
  end if;
  insert into user_invite_grants (chat_guid, granted)
  values (p_chat_guid, greatest(1, least(coalesce(p_amount, 0), 100)))
  on conflict (chat_guid) do update
    set granted = least(user_invite_grants.granted + greatest(1, least(coalesce(p_amount, 0), 100)), 2000),
        updated_at = now();
  select granted into v_granted from user_invite_grants where chat_guid = p_chat_guid;
  return v_granted;
end;
$$;

revoke all on function public.user_invite_remaining(text), public.mint_user_invite(text, text, int, text), public.add_user_invite_grant(text, int)
  from public, anon, authenticated;
grant execute on function public.user_invite_remaining(text), public.mint_user_invite(text, text, int, text), public.add_user_invite_grant(text, int)
  to service_role;
notify pgrst, 'reload schema';
