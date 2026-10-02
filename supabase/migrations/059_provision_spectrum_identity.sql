-- Bind an allowlisted iMessage chat to a Dinghy user WITHOUT Google.
--
-- Until now spectrum_identities.user_id was only set at the first Google
-- connect (bindSpectrumIdentity), so invited people had no user and lost the
-- computer and file tools until OAuth. This function creates the backing user
-- and the binding in one transaction, only for chats already on
-- beta_allowlist (same gate bindSpectrumIdentity enforces), and is idempotent:
-- a later Google connect finds the binding and attaches its tokens to the
-- same user.
--
-- No guessing: the only input that picks the identity is the chat_guid the
-- allowlist already trusts. The handle is optional and only filled when empty.
--
-- NOT applied by the patch. Run it, then the backfill block below.

create or replace function public.provision_spectrum_identity(p_chat_guid text, p_handle text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if p_chat_guid is null or length(p_chat_guid) = 0 then
    return null;
  end if;
  if not exists (select 1 from public.beta_allowlist where chat_guid = p_chat_guid) then
    return null;  -- not allowed in: never create an identity for a stranger
  end if;

  -- Serialize concurrent callers for the same chat (invite redeem + first
  -- message can race); the lock is released at commit.
  perform pg_advisory_xact_lock(hashtextextended('provision_spectrum_identity:' || p_chat_guid, 0));

  select user_id into v_user from public.spectrum_identities where chat_guid = p_chat_guid;
  if v_user is not null then
    if p_handle is not null then
      update public.spectrum_identities set handle = p_handle where chat_guid = p_chat_guid and handle is null;
    end if;
    return v_user;
  end if;

  insert into public.users (telegram_id, name) values (null, 'iMessage user') returning id into v_user;
  insert into public.spectrum_identities (chat_guid, handle, user_id, bound_at)
  values (p_chat_guid, p_handle, v_user, now())
  on conflict (chat_guid) do update
    set user_id = excluded.user_id,
        bound_at = excluded.bound_at,
        handle = coalesce(public.spectrum_identities.handle, excluded.handle);
  return v_user;
end;
$$;

revoke all on function public.provision_spectrum_identity(text, text) from public, anon, authenticated;
grant execute on function public.provision_spectrum_identity(text, text) to service_role;

-- Optional backfill, NOT run by this migration. The app provisions lazily on
-- an allowlisted chat's next message (loadImessageToolContext), so existing
-- invited people self-heal without it. Run only if you want every allowlisted
-- chat bound now (creates one users row per unbound allowlisted chat):
--   select count(*) from beta_allowlist a left join spectrum_identities i on i.chat_guid = a.chat_guid where i.user_id is null;
--   select public.provision_spectrum_identity(a.chat_guid) from beta_allowlist a
--     left join spectrum_identities i on i.chat_guid = a.chat_guid where i.user_id is null;

notify pgrst, 'reload schema';
