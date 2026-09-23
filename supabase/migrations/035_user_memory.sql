-- User-level memory (Workstream D). Builds on 024 + 027: memory today is
-- keyed by chat_guid, so facts learned over iMessage are invisible in the
-- user's other chats. When a chat is bound to a user via spectrum_identities
-- (migration 011), memory should read and write across ALL of that user's
-- chats. Unbound/guest chats stay chat_guid-isolated, unchanged.
--
--   * memories rows gain source_channel (e.g. 'imessage') — provenance
--   * user-scoped read RPCs aggregate over spectrum_identities bindings
--   * claim_user_memory_update keeps the exact per-chat cadence semantics of
--     claim_memory_update (024): atomic per-chat messages_seen advance, gated
--     on p_every new messages, but is guarded to bound chats only and returns
--     the user-level last_summary_at so old per-chat summaries aren't redone
--   * conversation summaries stay per-chat (they describe one conversation);
--     user-level recall searches across them

alter table public.memories add column if not exists source_channel text;

-- One rewritten profile per user (parallel to dinghy_profiles per chat).
create table if not exists public.dinghy_user_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  profile text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.dinghy_user_profiles enable row level security;
revoke all on public.dinghy_user_profiles from anon, authenticated, public;

-- ── Read path ────────────────────────────────────────────────────────────────

-- Profile + latest 2 summaries across ALL of a user's chats.
create or replace function public.dinghy_user_memory_context(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with user_chats as (
    select chat_guid from public.spectrum_identities where user_id = p_user_id
  )
  select jsonb_build_object(
    'profile', coalesce((select profile from public.dinghy_user_profiles where user_id = p_user_id), ''),
    'summaries', coalesce((
      select jsonb_agg(s.summary order by s.last_at)
      from (select s.summary, s.last_at from public.conversation_summaries s
            join user_chats c on c.chat_guid = s.chat_guid
            order by s.last_at desc limit 2) s
    ), '[]'::jsonb)
  );
$$;

-- Relevance search over a user's active facts (same embedding model only).
create or replace function public.match_user_memories(
  p_user_id uuid, p_embedding vector, p_model text, p_limit int default 5
) returns table (id uuid, type text, content text, valid_from timestamptz, similarity float)
language sql stable security definer set search_path = public as $$
  select m.id, m.type, m.content, m.valid_from, 1 - (m.embedding <=> p_embedding)
  from public.memories m
  where m.user_id = p_user_id and m.superseded_at is null
    and m.embedding is not null and m.embedding_model = p_model
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;

-- Newest active facts for a user (keyword/no-embeddings fallback + dedupe).
create or replace function public.recent_user_memories(p_user_id uuid, p_limit int default 30)
returns table (id uuid, type text, content text, valid_from timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.type, m.content, m.valid_from from public.memories m
  where m.user_id = p_user_id and m.superseded_at is null
  order by m.valid_from desc limit p_limit;
$$;

-- Older summaries that match this message, across the user's chats
-- (the latest 2 across the user are always included separately).
create or replace function public.match_user_summaries(
  p_user_id uuid, p_embedding vector, p_model text, p_limit int default 2
) returns table (id uuid, summary text, last_at timestamptz, similarity float)
language sql stable security definer set search_path = public as $$
  with user_chats as (
    select chat_guid from public.spectrum_identities where user_id = p_user_id
  ),
  latest as (
    select s.id from public.conversation_summaries s
    join user_chats c on c.chat_guid = s.chat_guid
    order by s.last_at desc limit 2
  )
  select s.id, s.summary, s.last_at, 1 - (s.embedding <=> p_embedding)
  from public.conversation_summaries s
  join user_chats c on c.chat_guid = s.chat_guid
  where s.embedding is not null and s.embedding_model = p_model
    and s.id not in (select id from latest)
  order by s.embedding <=> p_embedding
  limit p_limit;
$$;

-- ── Claim (same cadence semantics as 024's claim_memory_update) ──────────────
-- Atomic per-chat claim guarded to bound chats: returns one row (and advances
-- that chat's messages_seen) only when at least p_every new messages arrived
-- since the last update AND the chat is bound to p_user_id. last_summary_at
-- is the user-level max so summarization never redoes pre-binding stretches.
create or replace function public.claim_user_memory_update(p_user_id uuid, p_chat_guid text, p_every int)
returns table (total int, previously_seen int, last_summary_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_seen int; v_last timestamptz;
begin
  -- Guard: only bound chats may claim at user level.
  if not exists (
    select 1 from public.spectrum_identities
    where chat_guid = p_chat_guid and user_id = p_user_id
  ) then return; end if;

  insert into public.dinghy_profiles (chat_guid) values (p_chat_guid) on conflict do nothing;
  select messages_seen into v_seen from public.dinghy_profiles where chat_guid = p_chat_guid for update;
  select count(*) into v_total from public.spectrum_messages where chat_guid = p_chat_guid;
  if v_total - v_seen < p_every then return; end if;
  update public.dinghy_profiles set messages_seen = v_total where chat_guid = p_chat_guid;

  select max(s.last_at) into v_last
  from public.conversation_summaries s
  join public.spectrum_identities i on i.chat_guid = s.chat_guid
  where i.user_id = p_user_id;

  return query select v_total, v_seen, v_last;
end;
$$;

-- ── Write path ───────────────────────────────────────────────────────────────

create or replace function public.save_dinghy_user_profile(p_user_id uuid, p_profile text)
returns void language sql security definer set search_path = public as $$
  insert into public.dinghy_user_profiles (user_id, profile, updated_at)
  values (p_user_id, left(p_profile, 1500), now())
  on conflict (user_id) do update set profile = excluded.profile, updated_at = now();
$$;

-- User-level fact: user_id set (scopes recall across chats), chat_guid kept
-- as provenance, source_channel tags where it was learned.
create or replace function public.add_user_memory(
  p_user_id uuid, p_chat_guid text, p_channel text, p_type text, p_content text,
  p_embedding vector, p_model text
) returns uuid language sql security definer set search_path = public as $$
  insert into public.memories (user_id, chat_guid, source_channel, type, content, embedding, embedding_model)
  values (p_user_id, p_chat_guid, left(p_channel, 32), p_type, left(p_content, 500), p_embedding, p_model)
  returning id;
$$;

-- Chat-level fact insert, now with channel provenance (new overload; the
-- 024 signature stays for replay of old code paths).
create or replace function public.add_chat_memory(
  p_chat_guid text, p_channel text, p_type text, p_content text, p_embedding vector, p_model text
) returns uuid language sql security definer set search_path = public as $$
  insert into public.memories (chat_guid, source_channel, type, content, embedding, embedding_model)
  values (p_chat_guid, left(p_channel, 32), p_type, left(p_content, 500), p_embedding, p_model)
  returning id;
$$;

-- "forget X" across the user's chats: soft-delete (superseded), reversible.
create or replace function public.forget_user_memories(p_user_id uuid, p_match text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if length(trim(p_match)) < 4 then return 0; end if;
  update public.memories set superseded_at = now()
  where user_id = p_user_id and superseded_at is null
    and content ilike '%' || replace(replace(p_match, '%', '\%'), '_', '\_') || '%';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Rows for a user that need a (re-)embedding under the current model.
create or replace function public.user_rows_needing_embedding(p_user_id uuid, p_model text, p_limit int default 20)
returns table (kind text, id uuid, content text)
language sql stable security definer set search_path = public as $$
  (select 'fact'::text, m.id, m.content from public.memories m
   where m.user_id = p_user_id and m.superseded_at is null
     and (m.embedding is null or m.embedding_model is distinct from p_model)
   limit p_limit)
  union all
  (select 'summary'::text, s.id, s.summary from public.conversation_summaries s
   join public.spectrum_identities i on i.chat_guid = s.chat_guid
   where i.user_id = p_user_id
     and (s.embedding is null or s.embedding_model is distinct from p_model)
   limit p_limit);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'dinghy_user_memory_context(uuid)',
    'match_user_memories(uuid, vector, text, int)',
    'recent_user_memories(uuid, int)',
    'match_user_summaries(uuid, vector, text, int)',
    'claim_user_memory_update(uuid, text, int)',
    'save_dinghy_user_profile(uuid, text)',
    'add_user_memory(uuid, text, text, text, vector, text)',
    'add_chat_memory(text, text, text, vector, text)',
    'forget_user_memories(uuid, text)',
    'user_rows_needing_embedding(uuid, text, int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
