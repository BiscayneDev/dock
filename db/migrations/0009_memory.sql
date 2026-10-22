-- Shipyard Memory in Dock: per-owner, per-project memory items.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * Three scopes: 'conversation' (a finished chat turn), 'fact' (durable facts about the owner),
--     'project' (knowledge about one project; project_id required).
--   * A row belongs to one workspace and one owner. Owner-only RLS through workspace ownership.
--   * project_id, when set, must be a project of the same workspace (checked in the RLS policy).
--   * embedding is nullable: rows without an embedding stay keyword-searchable.
--     embedding_model tags every vector with the model that produced it.
--   * Deletes are hard deletes, owner-filtered in the app and by RLS.

begin;

create extension if not exists vector;

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  scope text not null check (scope in ('conversation', 'fact', 'project')),
  type text not null default 'fact' check (type in ('conversation', 'fact', 'person', 'preference', 'org', 'event')),
  content text not null check (char_length(content) between 1 and 4000),
  conversation_id uuid references public.conversations(id) on delete set null,
  embedding vector(1536),
  embedding_model text,
  created_at timestamptz not null default now(),
  constraint memory_items_project_scope check (scope <> 'project' or project_id is not null)
);

create index if not exists memory_items_owner_scope_idx on public.memory_items (owner_id, scope, created_at desc);
create index if not exists memory_items_project_idx on public.memory_items (project_id);

alter table public.memory_items enable row level security;

drop policy if exists memory_items_all_owner on public.memory_items;
create policy memory_items_all_owner on public.memory_items for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (
      project_id is null
      or project_id in (select p.id from public.projects p where p.workspace_id = public.memory_items.workspace_id)
    )
  );

-- Vector recall. Security invoker: RLS applies, so a caller only ever sees its own rows.
-- Owner-wide items (project_id null) plus items of the given project only.
create or replace function public.match_memory_items(
  p_owner uuid,
  p_project uuid,
  p_model text,
  p_embedding vector(1536),
  p_limit int default 8
)
returns table (id uuid, scope text, content text, project_id uuid, similarity float8)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, m.scope, m.content, m.project_id,
         1 - (m.embedding <=> p_embedding) as similarity
  from public.memory_items m
  where m.owner_id = p_owner
    and m.embedding is not null
    and m.embedding_model = p_model
    and (m.project_id is null or m.project_id = p_project)
  order by m.embedding <=> p_embedding
  limit greatest(1, least(p_limit, 50));
$$;

grant execute on function public.match_memory_items(uuid, uuid, text, vector, int) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
