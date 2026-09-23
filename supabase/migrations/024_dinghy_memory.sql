-- Dinghy memory: three layers, keyed by chat_guid (every iMessage chat has
-- one, connected or not). Raw spectrum_messages stay the source of truth;
-- everything here is derived and can be rebuilt.
--
--   1. dinghy_profiles         one short, rewritten profile per chat (always in the prompt)
--   2. conversation_summaries  episodic summaries of older stretches (latest 2 in the prompt)
--   3. memories (chat_guid)    atomic facts, retrieved by relevance to the current message
--
-- Reuses the existing memories table (migration 005/007) rather than adding
-- a second fact store: a row belongs to a users.id OR a chat_guid.

alter table public.memories alter column user_id drop not null;
alter table public.memories add column if not exists chat_guid text;
do $$ begin
  alter table public.memories
    add constraint memories_owner_chk check (user_id is not null or chat_guid is not null);
exception when duplicate_object then null; end $$;
create index if not exists memories_chat_active_idx
  on public.memories (chat_guid) where superseded_at is null and chat_guid is not null;

create table if not exists public.dinghy_profiles (
  chat_guid text primary key,
  profile text not null default '',
  messages_seen int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.dinghy_profiles enable row level security;
revoke all on public.dinghy_profiles from anon, authenticated, public;

create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  chat_guid text not null,
  summary text not null,
  message_count int not null,
  first_at timestamptz not null,
  last_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists conversation_summaries_chat_idx
  on public.conversation_summaries (chat_guid, last_at desc);
alter table public.conversation_summaries enable row level security;
revoke all on public.conversation_summaries from anon, authenticated, public;

-- Read path (one round trip): profile + latest 2 summaries.
create or replace function public.dinghy_memory_context(p_chat_guid text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', coalesce((select profile from public.dinghy_profiles where chat_guid = p_chat_guid), ''),
    'summaries', coalesce((
      select jsonb_agg(s.summary order by s.last_at)
      from (select summary, last_at from public.conversation_summaries
            where chat_guid = p_chat_guid order by last_at desc limit 2) s
    ), '[]'::jsonb)
  );
$$;

-- Relevance search over one chat's active facts (same embedding model only).
create or replace function public.match_chat_memories(
  p_chat_guid text, p_embedding vector, p_model text, p_limit int default 5
) returns table (id uuid, type text, content text, valid_from timestamptz, similarity float)
language sql stable security definer set search_path = public as $$
  select m.id, m.type, m.content, m.valid_from, 1 - (m.embedding <=> p_embedding)
  from public.memories m
  where m.chat_guid = p_chat_guid and m.superseded_at is null
    and m.embedding is not null and m.embedding_model = p_model
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;

-- Newest active facts for a chat (keyword/no-embeddings fallback + extractor dedupe).
create or replace function public.recent_chat_memories(p_chat_guid text, p_limit int default 30)
returns table (id uuid, type text, content text, valid_from timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.type, m.content, m.valid_from from public.memories m
  where m.chat_guid = p_chat_guid and m.superseded_at is null
  order by m.valid_from desc limit p_limit;
$$;

-- Atomic "is a memory update due?" claim. Returns one row (and advances
-- messages_seen) only when at least p_every new messages arrived since the
-- last update, so concurrent invocations never double-run.
create or replace function public.claim_memory_update(p_chat_guid text, p_every int)
returns table (total int, previously_seen int, last_summary_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_total int; v_seen int;
begin
  insert into public.dinghy_profiles (chat_guid) values (p_chat_guid) on conflict do nothing;
  select messages_seen into v_seen from public.dinghy_profiles where chat_guid = p_chat_guid for update;
  select count(*) into v_total from public.spectrum_messages where chat_guid = p_chat_guid;
  if v_total - v_seen < p_every then return; end if;
  update public.dinghy_profiles set messages_seen = v_total where chat_guid = p_chat_guid;
  return query select v_total, v_seen,
    (select max(s.last_at) from public.conversation_summaries s where s.chat_guid = p_chat_guid);
end;
$$;

create or replace function public.save_dinghy_profile(p_chat_guid text, p_profile text)
returns void language sql security definer set search_path = public as $$
  insert into public.dinghy_profiles (chat_guid, profile, updated_at)
  values (p_chat_guid, left(p_profile, 1500), now())
  on conflict (chat_guid) do update set profile = excluded.profile, updated_at = now();
$$;

create or replace function public.add_conversation_summary(
  p_chat_guid text, p_summary text, p_message_count int, p_first_at timestamptz, p_last_at timestamptz
) returns void language sql security definer set search_path = public as $$
  insert into public.conversation_summaries (chat_guid, summary, message_count, first_at, last_at)
  values (p_chat_guid, left(p_summary, 2000), p_message_count, p_first_at, p_last_at);
$$;

create or replace function public.add_chat_memory(
  p_chat_guid text, p_type text, p_content text, p_embedding vector, p_model text
) returns uuid language sql security definer set search_path = public as $$
  insert into public.memories (chat_guid, type, content, embedding, embedding_model)
  values (p_chat_guid, p_type, left(p_content, 500), p_embedding, p_model)
  returning id;
$$;

-- "forget X": soft-delete (superseded), reversible.
create or replace function public.forget_chat_memories(p_chat_guid text, p_match text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if length(trim(p_match)) < 4 then return 0; end if;
  update public.memories set superseded_at = now()
  where chat_guid = p_chat_guid and superseded_at is null
    and content ilike '%' || replace(replace(p_match, '%', '\%'), '_', '\_') || '%';
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'dinghy_memory_context(text)',
    'match_chat_memories(text, vector, text, int)',
    'recent_chat_memories(text, int)',
    'claim_memory_update(text, int)',
    'save_dinghy_profile(text, text)',
    'add_conversation_summary(text, text, int, timestamptz, timestamptz)',
    'add_chat_memory(text, text, text, vector, text)',
    'forget_chat_memories(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
