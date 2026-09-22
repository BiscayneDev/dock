-- Native memory layer
create extension if not exists vector;

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null default 'fact'
    check (type in ('fact','person','preference','org','event')),
  content text not null,
  embedding vector(1536),
  source_message_id uuid,
  valid_from timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists memories_user_active_idx
  on memories (user_id) where superseded_at is null;
create index if not exists memories_embedding_idx
  on memories using hnsw (embedding vector_cosine_ops)
  where superseded_at is null;
create index if not exists messages_user_created_idx
  on messages (user_id, created_at desc);

create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit int default 8
)
returns table (
  id uuid, type text, content text,
  valid_from timestamptz, similarity float
)
language sql stable
as $$
  select m.id, m.type, m.content, m.valid_from,
         1 - (m.embedding <=> p_embedding) as similarity
  from memories m
  where m.user_id = p_user_id
    and m.superseded_at is null
    and m.embedding is not null
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;

create extension if not exists pg_trgm;
create index if not exists messages_content_trgm_idx
  on messages using gin (content gin_trgm_ops);

alter table messages add column if not exists compacted boolean not null default false;
