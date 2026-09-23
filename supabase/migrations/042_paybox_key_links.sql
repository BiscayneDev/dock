-- One-use links for pasting a PayBox pbxk1 signing key from an iMessage thread.
--
-- iMessage users have no web session, so Dinghy texts them a link to a page
-- with a masked field. The raw link token is never stored: only sha256(token).
-- A link is valid for 15 minutes and can save a key once. The key itself is
-- stored encrypted on oauth_tokens.signing_key (migration 005), never here.

create table if not exists public.paybox_key_links (
  token_hash text primary key,
  user_id uuid not null references public.users (id) on delete cascade,
  chat_guid text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.paybox_key_links enable row level security;
revoke all on public.paybox_key_links from anon, authenticated, public;

create or replace function public.create_paybox_key_link(p_hash text, p_user uuid, p_chat text, p_ttl_seconds int)
returns void language sql security definer set search_path = public as $$
  insert into public.paybox_key_links (token_hash, user_id, chat_guid, expires_at)
  values (p_hash, p_user, p_chat, now() + make_interval(secs => p_ttl_seconds));
  delete from public.paybox_key_links where expires_at < now() - interval '1 day';
$$;

-- Read a live link without using it (the page checks before showing the form).
create or replace function public.peek_paybox_key_link(p_hash text)
returns table (user_id uuid, chat_guid text) language sql security definer set search_path = public as $$
  select l.user_id, l.chat_guid from public.paybox_key_links l
  where l.token_hash = p_hash and l.used_at is null and l.expires_at > now();
$$;

-- Atomically use a live link. Returns no row if it was already used or expired.
create or replace function public.consume_paybox_key_link(p_hash text)
returns table (user_id uuid, chat_guid text) language sql security definer set search_path = public as $$
  update public.paybox_key_links l set used_at = now()
  where l.token_hash = p_hash and l.used_at is null and l.expires_at > now()
  returning l.user_id, l.chat_guid;
$$;

revoke all on function public.create_paybox_key_link(text, uuid, text, int) from public, anon, authenticated;
revoke all on function public.peek_paybox_key_link(text) from public, anon, authenticated;
revoke all on function public.consume_paybox_key_link(text) from public, anon, authenticated;
grant execute on function public.create_paybox_key_link(text, uuid, text, int) to service_role;
grant execute on function public.peek_paybox_key_link(text) to service_role;
grant execute on function public.consume_paybox_key_link(text) to service_role;

notify pgrst, 'reload schema';
