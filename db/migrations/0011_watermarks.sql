-- Feed watermarks: per-owner, per-feed dedup cursor (newest seen item id + timestamp).
-- Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * One watermark per (owner_id, feed_id): the cursor state of a feed subscription.
--   * value is jsonb: { seenAt: iso-timestamp, lastItemId: text } written by the app.
--   * A row belongs to one owner. Owner-only RLS through workspace ownership.
--   * Deletes are hard deletes, owner-filtered in the app and by RLS.

begin;

create table if not exists public.watermarks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  feed_id text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint watermarks_owner_feed_unique unique (owner_id, feed_id)
);

alter table public.watermarks enable row level security;

drop policy if exists watermarks_all_owner on public.watermarks;
create policy watermarks_all_owner on public.watermarks for all to authenticated
  using (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  )
  with check (
    owner_id = (select auth.uid())
    and workspace_id in (select w.id from public.workspaces w where w.owner_id = (select auth.uid()))
  );

commit;

notify pgrst, 'reload schema';
