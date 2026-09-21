-- Tag memories with the embedding model that produced their vector, so a
-- deployment-level model switch can be detected instead of silently
-- comparing vectors across incompatible embedding spaces.
alter table memories add column if not exists embedding_model text;
