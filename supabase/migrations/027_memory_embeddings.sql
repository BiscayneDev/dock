-- Memory embeddings, done properly (builds on 024).
--   * episodic summaries get vectors too, so "what did we talk about last
--     week" pulls the relevant older summary, not just the latest two
--   * one RPC lists rows whose vector is missing or from another model, so
--     the write pass can backfill / re-embed them
-- Everything stays additive and reversible: new nullable columns, no drops.

alter table public.conversation_summaries add column if not exists embedding vector;
alter table public.conversation_summaries add column if not exists embedding_model text;

-- Relevant older summaries (excludes the latest 2, which are always shown).
create or replace function public.match_chat_summaries(
  p_chat_guid text, p_embedding vector, p_model text, p_limit int default 2
) returns table (id uuid, summary text, last_at timestamptz, similarity float)
language sql stable security definer set search_path = public as $$
  with latest as (
    select s.id from public.conversation_summaries s
    where s.chat_guid = p_chat_guid order by s.last_at desc limit 2
  )
  select s.id, s.summary, s.last_at, 1 - (s.embedding <=> p_embedding)
  from public.conversation_summaries s
  where s.chat_guid = p_chat_guid
    and s.embedding is not null and s.embedding_model = p_model
    and s.id not in (select id from latest)
  order by s.embedding <=> p_embedding
  limit p_limit;
$$;

-- Summary insert with an optional vector (replaces add_conversation_summary callers).
create or replace function public.add_conversation_summary_v2(
  p_chat_guid text, p_summary text, p_message_count int, p_first_at timestamptz, p_last_at timestamptz,
  p_embedding vector, p_model text
) returns uuid language sql security definer set search_path = public as $$
  insert into public.conversation_summaries (chat_guid, summary, message_count, first_at, last_at, embedding, embedding_model)
  values (p_chat_guid, left(p_summary, 2000), p_message_count, p_first_at, p_last_at, p_embedding, p_model)
  returning id;
$$;

-- Rows for one chat that need a (re-)embedding under the current model.
create or replace function public.chat_rows_needing_embedding(p_chat_guid text, p_model text, p_limit int default 20)
returns table (kind text, id uuid, content text)
language sql stable security definer set search_path = public as $$
  (select 'fact'::text, m.id, m.content from public.memories m
   where m.chat_guid = p_chat_guid and m.superseded_at is null
     and (m.embedding is null or m.embedding_model is distinct from p_model)
   limit p_limit)
  union all
  (select 'summary'::text, s.id, s.summary from public.conversation_summaries s
   where s.chat_guid = p_chat_guid
     and (s.embedding is null or s.embedding_model is distinct from p_model)
   limit p_limit);
$$;

create or replace function public.set_chat_embedding(p_kind text, p_id uuid, p_embedding vector, p_model text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'fact' then
    update public.memories set embedding = p_embedding, embedding_model = p_model where id = p_id and chat_guid is not null;
  elsif p_kind = 'summary' then
    update public.conversation_summaries set embedding = p_embedding, embedding_model = p_model where id = p_id;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'match_chat_summaries(text, vector, text, int)',
    'add_conversation_summary_v2(text, text, int, timestamptz, timestamptz, vector, text)',
    'chat_rows_needing_embedding(text, text, int)',
    'set_chat_embedding(text, uuid, vector, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
