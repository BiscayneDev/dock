-- Every new member gets 3 invites to give out (Halsey, Oct 2). Applies to rows
-- inserted from here on; existing members are untouched (admin grants stay as
-- they are). Owner and demo-chat rows are excluded. Idempotent: an existing
-- grant row is never overwritten.
create or replace function public.grant_default_invites()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'member' and new.chat_guid not like 'demo;-;%' then
    insert into user_invite_grants (chat_guid, granted) values (new.chat_guid, 3)
    on conflict (chat_guid) do nothing;
  end if;
  return new;
end $$;

revoke all on function public.grant_default_invites() from anon, authenticated, public;

drop trigger if exists beta_allowlist_default_invites on public.beta_allowlist;
create trigger beta_allowlist_default_invites
  after insert on public.beta_allowlist
  for each row execute function public.grant_default_invites();
