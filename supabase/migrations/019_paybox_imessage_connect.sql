-- PayBox connect from iMessage + serverless-safe PayBox token refresh.
--
-- connect_tokens gains a provider (google | paybox) and server-side PKCE
-- state: the iMessage flow has no browser session to hold the verifier in
-- a cookie, so it rides on the consumed token row (encrypted at rest with
-- ENCRYPTION_KEY, cleared on claim).
--
-- Every read/write touching the new columns goes through an RPC: PostgREST's
-- schema cache has repeatedly failed to pick up new columns after
-- migrations (see 017). RPC bodies are parsed by Postgres at call time.

alter table public.connect_tokens add column if not exists provider text not null default 'google';
do $$ begin
  alter table public.connect_tokens
    add constraint connect_tokens_provider_chk check (provider in ('google', 'paybox'));
exception when duplicate_object then null; end $$;
alter table public.connect_tokens add column if not exists pkce_verifier text;
alter table public.connect_tokens add column if not exists oauth_client_id text;

-- PayBox rotates refresh tokens on every use and REVOKES the client if a
-- rotated token is replayed. Two lambdas refreshing concurrently would
-- disconnect the user, so refresh takes a short lease first.
alter table public.oauth_tokens add column if not exists refresh_lock_at timestamptz;

create or replace function public.create_connect_token(
  p_token_hash text, p_platform text, p_chat_id text, p_pending_request text,
  p_expires_at timestamptz, p_provider text
) returns uuid
language sql security definer set search_path = public as $$
  insert into public.connect_tokens (token_hash, platform, chat_id, pending_request, expires_at, provider)
  values (p_token_hash, p_platform, p_chat_id, p_pending_request, p_expires_at, p_provider)
  returning connect_tokens.id;
$$;

-- Step 1: atomically consume a token for ONE provider (a google link can
-- never start a paybox flow and vice versa) and bind the OAuth state.
create or replace function public.begin_connect(
  p_token_hash text, p_provider text, p_oauth_state text,
  p_pkce_verifier text default null, p_client_id text default null
) returns table (platform text, chat_id text)
language sql security definer set search_path = public as $$
  update public.connect_tokens
  set used_at = now(), oauth_state = p_oauth_state,
      pkce_verifier = p_pkce_verifier, oauth_client_id = p_client_id
  where connect_tokens.token_hash = p_token_hash
    and connect_tokens.provider = p_provider
    and connect_tokens.used_at is null
    and connect_tokens.expires_at > now()
  returning connect_tokens.platform, connect_tokens.chat_id;
$$;

-- Step 3: claim the callback side by state, for one provider. Returns the
-- PKCE material once and clears it in the same statement.
create or replace function public.claim_connect_by_state(p_oauth_state text, p_provider text)
returns table (id uuid, platform text, chat_id text, pending_request text,
               pkce_verifier text, oauth_client_id text)
language sql security definer set search_path = public as $$
  with target as (
    select ct.id, ct.pkce_verifier, ct.oauth_client_id
    from public.connect_tokens ct
    where ct.oauth_state = p_oauth_state
      and ct.provider = p_provider
      and ct.used_at is not null
      and ct.completed_at is null
      and ct.claimed_at is null
      and ct.terminal_at is null
    for update
  )
  update public.connect_tokens c
  set claimed_at = now(), pkce_verifier = null
  from target
  where c.id = target.id
  returning c.id, c.platform, c.chat_id, c.pending_request, target.pkce_verifier, target.oauth_client_id;
$$;

-- Resume claim now also reports which provider was connected, so the
-- follow-up text can say the right thing.
drop function if exists public.claim_pending_resume(text, int);
create function public.claim_pending_resume(p_chat_id text, p_lease_ms int)
returns table (id uuid, pending_request text, provider text)
language sql security definer set search_path = public as $$
  update public.connect_tokens
  set delivery_claimed_at = now()
  where connect_tokens.id = (
    select ct.id from public.connect_tokens ct
    where ct.platform = 'imessage'
      and ct.chat_id = p_chat_id
      and ct.completed_at is not null
      and ct.resumed_at is null
      and ct.terminal_at is null
      and ct.pending_request is not null
      and (ct.delivery_claimed_at is null
           or ct.delivery_claimed_at < now() - make_interval(secs => p_lease_ms / 1000.0))
    order by ct.completed_at desc
    limit 1
    for update skip locked
  )
  returning connect_tokens.id, connect_tokens.pending_request, connect_tokens.provider;
$$;

create or replace function public.claim_paybox_refresh(p_user_id uuid, p_lease_ms int)
returns boolean
language sql security definer set search_path = public as $$
  with claimed as (
    update public.oauth_tokens
    set refresh_lock_at = now()
    where user_id = p_user_id and provider = 'paybox'
      and (refresh_lock_at is null
           or refresh_lock_at < now() - make_interval(secs => p_lease_ms / 1000.0))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

create or replace function public.release_paybox_refresh(p_user_id uuid)
returns void
language sql security definer set search_path = public as $$
  update public.oauth_tokens set refresh_lock_at = null
  where user_id = p_user_id and provider = 'paybox';
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_connect_token(text, text, text, text, timestamptz, text)',
    'public.begin_connect(text, text, text, text, text)',
    'public.claim_connect_by_state(text, text)',
    'public.claim_pending_resume(text, int)',
    'public.claim_paybox_refresh(uuid, int)',
    'public.release_paybox_refresh(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
