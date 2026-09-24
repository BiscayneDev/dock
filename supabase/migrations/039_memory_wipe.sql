-- Knows-me pass, part 1 (Workstream F): /memory transparency + forget-all.
--
--   * forget_all_user_memories / forget_all_chat_memories
--         soft-delete (supersede) every active memory for the user / chat.
--         The 024/035 "forget X" RPCs require a match of 4+ chars, so there
--         was no way to wipe everything; the "wipe all" flow needs one.
--   * dinghy_memory_wipes  one row per chat with an open "wipe all" request:
--         the confirmation gate ("reply YES to wipe it all") survives across
--         messages, stateless-serverless safe. Row is deleted on confirm or
--         on any other reply.

create or replace function public.forget_all_user_memories(p_user_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.memories set superseded_at = now()
  where user_id = p_user_id and superseded_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.forget_all_chat_memories(p_chat_guid text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.memories set superseded_at = now()
  where chat_guid = p_chat_guid and superseded_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

create table if not exists public.dinghy_memory_wipes (
  chat_guid text primary key,
  requested_at timestamptz not null default now()
);
alter table public.dinghy_memory_wipes enable row level security;
revoke all on public.dinghy_memory_wipes from anon, authenticated, public;

do $$
declare f text;
begin
  foreach f in array array[
    'forget_all_user_memories(uuid)',
    'forget_all_chat_memories(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
