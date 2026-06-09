-- Durable semantic memory (RAG).
-- Replaces the lossy "summarize then delete" behavior with retrievable memory:
-- salient facts and conversation summaries are embedded and recalled by
-- similarity each turn. Service-role only (no policies) — accessed server-side.
create extension if not exists vector;

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text not null default 'fact',          -- fact | conversation_summary | message
  content text not null,
  embedding vector(1536),                      -- OpenAI text-embedding-3-small
  source_message_id uuid,
  created_at timestamptz default now()
);

create index if not exists idx_memories_user_kind on memories(user_id, kind);
create index if not exists idx_memories_embedding
  on memories using hnsw (embedding vector_cosine_ops);

alter table memories enable row level security;

-- Cosine-similarity recall scoped to a user.
-- Mark messages already folded into a conversation_summary memory so they're
-- never re-summarized (we keep the rows rather than deleting them).
alter table messages add column if not exists summarized boolean default false;

create or replace function match_memories(
  query_embedding vector(1536),
  match_user uuid,
  match_count int default 6
)
returns table (id uuid, content text, kind text, similarity float)
language sql stable
set search_path = public
as $$
  select m.id, m.content, m.kind, 1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.user_id = match_user and m.embedding is not null
  order by m.embedding <=> query_embedding
  limit match_count
$$;
