-- 047: more than one Google account per user.
--
-- No table change. oauth_tokens keeps unique(user_id, provider): the primary
-- Google account stays provider 'google' (every existing reader keeps
-- working); extra accounts are 'google:<lowercased email>'.
--
-- set_primary_google swaps the providers of the current primary and the
-- chosen account in one transaction. Returns false when the email isn't
-- connected, true when it is (already primary or now primary).

create or replace function public.set_primary_google(p_user_id uuid, p_email text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
  target_provider text;
  old_id uuid;
  old_email text;
begin
  select id, provider into target_id, target_provider
  from oauth_tokens
  where user_id = p_user_id
    and (provider = 'google' or provider like 'google:%')
    and lower(provider_account_email) = lower(p_email)
  for update;
  if target_id is null then return false; end if;
  if target_provider = 'google' then return true; end if;

  select id, lower(coalesce(provider_account_email, 'unknown-' || id::text)) into old_id, old_email
  from oauth_tokens where user_id = p_user_id and provider = 'google'
  for update;

  if old_id is not null then
    update oauth_tokens set provider = 'google:__swap' where id = old_id;
  end if;
  update oauth_tokens set provider = 'google', updated_at = now() where id = target_id;
  if old_id is not null then
    update oauth_tokens set provider = 'google:' || old_email, updated_at = now() where id = old_id;
  end if;
  return true;
end;
$$;

revoke all on function public.set_primary_google(uuid, text) from public, anon, authenticated;

-- Disconnecting a Google account from iMessage is a confirm-with-y draft.
alter table public.dinghy_pending_actions
  drop constraint if exists dinghy_pending_actions_kind_check;
alter table public.dinghy_pending_actions
  add constraint dinghy_pending_actions_kind_check
  check (kind in ('gmail_send', 'gmail_reply', 'gcal_create_invite', 'computer_browse', 'google_disconnect'));
