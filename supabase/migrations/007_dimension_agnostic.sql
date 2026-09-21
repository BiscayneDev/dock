-- Dimension-agnostic embeddings: open models served via Shipyard Inference
-- emit varying dimensions (768/1024/etc). Drop the fixed 1536 typmod; the
-- per-row embedding_model tag + code-level checks guard consistency.
drop index if exists memories_embedding_idx;
alter table memories alter column embedding type vector;

create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector,
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
    and m.embedding_model = (
      select m2.embedding_model from memories m2
      where m2.embedding is not null
      order by m2.created_at desc limit 1
    )
  order by m.embedding <=> p_embedding
  limit p_limit;
$$;

-- NOTE: no HNSW index on a dimensionless vector column (pgvector requires
-- fixed dimensions to index). Acceptable: match_memories scans one user's
-- memories (dozens-hundreds of rows), sequential scan is fine at this scale.
