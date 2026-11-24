-- Knowledge factory backend (WS3): DB-backed knowledge documents, flags, curator proposals,
-- and an append-only proposal audit trail.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * A document belongs to one workspace and one owner. The canonical concept id (`doc_id`) is
--     unique per workspace; `body` holds the markdown body and `frontmatter` the structured
--     frontmatter, so the portable OKF serialization can be regenerated from the row.
--   * trust_tier / freshness / content_hash are computed by lib/knowledge-schema.ts, never trusted
--     from a client. A curator edit demotes human-reviewed -> machine-confirmed until a human
--     re-review; nothing in this schema promotes a document on its own.
--   * Flags are deduplicated by flag_hash (the stable id from lib/knowledge-flags.ts).
--   * knowledge_proposals holds planner output as jsonb plus decision state. The planner only ever
--     proposes; applying happens exclusively through the approval path, which also appends to
--     knowledge_proposal_events.
--   * knowledge_proposal_events mirrors decision_verdicts (0012): append-only for the owner
--     (select + insert policies only, no update/delete policy exists).
--   * Owner-only RLS on all four tables, same shape as 0002/0004/0005/0007/0012. Workers and the
--     agent-token callback write through the service role.

begin;

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  doc_id text not null check (char_length(doc_id) between 1 and 500),
  doc_path text not null check (char_length(doc_path) between 1 and 600),
  type text not null check (type in ('skill', 'domain', 'data_access')),
  title text,
  description text,
  resource text,
  status text not null default 'active' check (status in ('active', 'stale', 'superseded')),
  trust_tier text not null default 'unverified'
    check (trust_tier in ('unverified', 'machine-confirmed', 'human-reviewed')),
  freshness text not null default 'unknown' check (freshness in ('fresh', 'stale', 'malformed', 'unknown')),
  tags jsonb not null default '[]'::jsonb check (jsonb_typeof(tags) = 'array'),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  stale_after text check (stale_after is null or char_length(stale_after) <= 64),
  superseded_by text check (superseded_by is null or char_length(superseded_by) <= 500),
  content_hash text not null check (char_length(content_hash) = 64),
  body text not null check (char_length(body) between 1 and 200000),
  frontmatter jsonb not null default '{}'::jsonb check (jsonb_typeof(frontmatter) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_workspace_doc_unique unique (workspace_id, doc_id)
);
create index if not exists knowledge_documents_workspace_type_idx
  on public.knowledge_documents (workspace_id, type);
create index if not exists knowledge_documents_workspace_status_idx
  on public.knowledge_documents (workspace_id, status);

create table if not exists public.knowledge_flags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  flag_hash text not null check (char_length(flag_hash) between 1 and 80),
  kind text not null check (kind in ('missing', 'wrong', 'stale')),
  ref text check (ref is null or char_length(ref) <= 500),
  suggested_fix text check (suggested_fix is null or char_length(suggested_fix) <= 8000),
  evidence jsonb check (evidence is null or jsonb_typeof(evidence) in ('string', 'array', 'object')),
  run_id text check (run_id is null or char_length(run_id) <= 200),
  created_at timestamptz not null default now(),
  constraint knowledge_flags_workspace_hash_unique unique (workspace_id, flag_hash)
);
create index if not exists knowledge_flags_workspace_kind_idx
  on public.knowledge_flags (workspace_id, kind, created_at desc);

create table if not exists public.knowledge_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  proposal_key text not null check (char_length(proposal_key) between 1 and 80),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_by uuid references public.users(id) on delete set null,
  decision_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 2000),
  applied_doc_id text check (applied_doc_id is null or char_length(applied_doc_id) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_proposals_workspace_key_unique unique (workspace_id, proposal_key)
);
create index if not exists knowledge_proposals_workspace_status_idx
  on public.knowledge_proposals (workspace_id, status, created_at desc);

create table if not exists public.knowledge_proposal_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.knowledge_proposals(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  event text not null check (event in ('proposed', 'approved', 'rejected', 'failed')),
  proposal_hash text not null check (char_length(proposal_hash) = 64),
  reason text check (reason is null or char_length(reason) <= 2000),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists knowledge_proposal_events_proposal_created_idx
  on public.knowledge_proposal_events (proposal_id, created_at);
create index if not exists knowledge_proposal_events_workspace_created_idx
  on public.knowledge_proposal_events (workspace_id, created_at desc);

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_flags enable row level security;
alter table public.knowledge_proposals enable row level security;
alter table public.knowledge_proposal_events enable row level security;

drop policy if exists knowledge_documents_all_owner on public.knowledge_documents;
create policy knowledge_documents_all_owner on public.knowledge_documents for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists knowledge_flags_all_owner on public.knowledge_flags;
create policy knowledge_flags_all_owner on public.knowledge_flags for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists knowledge_proposals_all_owner on public.knowledge_proposals;
create policy knowledge_proposals_all_owner on public.knowledge_proposals for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

-- Append-only audit for the owner: select and insert only. No update or delete policy exists.
drop policy if exists knowledge_proposal_events_select_owner on public.knowledge_proposal_events;
create policy knowledge_proposal_events_select_owner on public.knowledge_proposal_events for select to authenticated
  using (
    workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

drop policy if exists knowledge_proposal_events_insert_owner on public.knowledge_proposal_events;
create policy knowledge_proposal_events_insert_owner on public.knowledge_proposal_events for insert to authenticated
  with check (
    workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
    and (actor_id is null or actor_id = (select auth.uid()))
  );

commit;

notify pgrst, 'reload schema';
