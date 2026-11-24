-- WS5 per-run identity: acting-principal attribution on task_runs (migration 0005).
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * Append-only, additive change: no column is dropped, renamed or rebuilt, and no RLS
--     policy is touched. Existing rows keep their meaning; actor_kind defaults to 'owner'
--     because every run queued before this migration was enqueued by its owner session.
--   * acting_as references public.users(id) with ON DELETE SET NULL: when a user row goes
--     away the run keeps its history but loses the human link (never re-attributed).
--   * actor_kind is constrained to the three known kinds. No other value can be stored, so
--     downstream readers never have to guess.
--   * agent_token actions carry acting_as = null by construction in lib/queue.ts: the token
--     identifies a credential, not a person. Never invent an owner for those runs.
--   * actor_ref is a free-form correlation id (<=200 chars) for the credential/connection
--     that acted; it is not a foreign key.

begin;

alter table public.task_runs
  add column if not exists acting_as uuid references public.users(id) on delete set null,
  add column if not exists actor_kind text not null default 'owner'
    check (actor_kind in ('owner', 'agent_token', 'connector')),
  add column if not exists actor_ref text
    check (actor_ref is null or char_length(actor_ref) <= 200);

create index if not exists task_runs_workspace_actor_idx
  on public.task_runs (workspace_id, actor_kind);

commit;

notify pgrst, 'reload schema';
