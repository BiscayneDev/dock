-- Assistant conversations in Supabase, grouped by project.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A conversation belongs to one workspace and one owner. project_id null = "No project".
--   * project_id, when set, must be a project of the same workspace (checked in the RLS policy).
--   * Messages inherit ownership from their conversation. RLS on both tables, owner-only.
--   * Older file-based chats (data/conversations.json) are not copied here; the app lists them under "No project".

begin;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null default 'New chat' check (char_length(title) <= 200),
  agent text not null default 'vic' check (char_length(agent) <= 64),
  preview text not null default '' check (char_length(preview) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_workspace_updated_idx on public.conversations (workspace_id, updated_at desc);
create index if not exists conversations_project_idx on public.conversations (project_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'agent')),
  content text not null default '' check (char_length(content) <= 200000),
  agent text not null default 'vic' check (char_length(agent) <= 64),
  -- Free-form metadata: runId, projectId for actions taken in a project, intro flag.
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_created_idx on public.messages (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

drop policy if exists conversations_all_owner on public.conversations;
create policy conversations_all_owner on public.conversations for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (
      project_id is null
      or project_id in (select p.id from public.projects p where p.workspace_id = public.conversations.workspace_id)
    )
  );

drop policy if exists messages_all_owner on public.messages;
create policy messages_all_owner on public.messages for all to authenticated
  using (conversation_id in (select c.id from public.conversations c where c.owner_id = (select auth.uid())))
  with check (conversation_id in (select c.id from public.conversations c where c.owner_id = (select auth.uid())));

commit;

notify pgrst, 'reload schema';
