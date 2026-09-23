-- In-chat confirmation for iMessage actions that act AS the user.
--
-- The model can only PROPOSE these (send an email, reply, send calendar
-- invites). The proposal is stored here and the server texts the exact
-- draft; the action runs only when the user's next message is a clear
-- "yes". Anything else cancels it. One pending action per chat; 30 min TTL.

create table if not exists public.dinghy_pending_actions (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null,
  user_id uuid not null,
  kind text not null check (kind in ('gmail_send', 'gmail_reply', 'gcal_create_invite')),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'executing', 'done', 'failed', 'cancelled')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  finished_at timestamptz
);
create index if not exists dinghy_pending_actions_chat_idx
  on public.dinghy_pending_actions (chat_guid, status);
alter table public.dinghy_pending_actions enable row level security;
revoke all on public.dinghy_pending_actions from anon, authenticated, public;

-- New proposal supersedes any open one for the chat.
create or replace function public.create_pending_action(
  p_chat_guid text, p_user_id uuid, p_kind text, p_payload jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update public.dinghy_pending_actions set status = 'cancelled', finished_at = now()
  where chat_guid = p_chat_guid and status = 'pending';
  insert into public.dinghy_pending_actions (chat_guid, user_id, kind, payload)
  values (p_chat_guid, p_user_id, p_kind, p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

-- Is there an open, unexpired proposal for this chat? (no state change)
create or replace function public.peek_pending_action(p_chat_guid text)
returns table (id uuid, kind text)
language sql stable security definer set search_path = public as $$
  select id, kind from public.dinghy_pending_actions
  where chat_guid = p_chat_guid and status = 'pending' and expires_at > now()
  order by created_at desc limit 1;
$$;

-- Atomically take the open proposal for execution (exactly once).
create or replace function public.claim_pending_action(p_chat_guid text)
returns table (id uuid, user_id uuid, kind text, payload jsonb)
language sql security definer set search_path = public as $$
  update public.dinghy_pending_actions a set status = 'executing'
  where a.id = (
    select p.id from public.dinghy_pending_actions p
    where p.chat_guid = p_chat_guid and p.status = 'pending' and p.expires_at > now()
    order by p.created_at desc limit 1
    for update skip locked
  )
  returning a.id, a.user_id, a.kind, a.payload;
$$;

create or replace function public.finish_pending_action(p_id uuid, p_status text, p_result jsonb)
returns void
language sql security definer set search_path = public as $$
  update public.dinghy_pending_actions
  set status = p_status, result = p_result, finished_at = now()
  where id = p_id;
$$;

create or replace function public.cancel_pending_actions(p_chat_guid text) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  update public.dinghy_pending_actions set status = 'cancelled', finished_at = now()
  where chat_guid = p_chat_guid and status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.create_pending_action(text, uuid, text, jsonb) from anon, authenticated, public;
revoke execute on function public.peek_pending_action(text) from anon, authenticated, public;
revoke execute on function public.claim_pending_action(text) from anon, authenticated, public;
revoke execute on function public.finish_pending_action(uuid, text, jsonb) from anon, authenticated, public;
revoke execute on function public.cancel_pending_actions(text) from anon, authenticated, public;
grant execute on function public.create_pending_action(text, uuid, text, jsonb) to service_role;
grant execute on function public.peek_pending_action(text) to service_role;
grant execute on function public.claim_pending_action(text) to service_role;
grant execute on function public.finish_pending_action(uuid, text, jsonb) to service_role;
grant execute on function public.cancel_pending_actions(text) to service_role;

notify pgrst, 'reload schema';
