-- Task assignments: one task can be delegated to several subagents, each with its own prompt.
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction. NOT applied yet.
--
-- Invariants:
--   * assignments is a JSON array of { agentKey, prompt }. Written at proposal time, read at approval time.
--   * Runs are found by task_runs.payload.briefId. Per-run status is never copied here.
--   * Owner-only RLS on project_briefs (0006) covers this column.

begin;

alter table public.project_briefs
  add column if not exists assignments jsonb not null default '[]'::jsonb;

alter table public.project_briefs
  drop constraint if exists project_briefs_assignments_shape;
alter table public.project_briefs
  add constraint project_briefs_assignments_shape
  check (jsonb_typeof(assignments) = 'array' and jsonb_array_length(assignments) between 0 and 4);

commit;

notify pgrst, 'reload schema';
