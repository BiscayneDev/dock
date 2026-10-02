-- REVIEW ONLY. Apply before deploying the profile files feature.
-- No daily brief storage, outbox changes, retention jobs or historical backfill.
begin;
alter table public.dinghy_files
  add column if not exists kind text not null default 'file' check (kind in ('file','itinerary')),
  add column if not exists revoked_at timestamptz;
-- Existing files remain kind=file; no title-based itinerary guesses.
-- Existing table RLS and role revocations stay unchanged.
commit;
notify pgrst, 'reload schema';
-- Rollback: revert code first. Keep metadata until reviewed data removal;
-- dropping revoked_at would forget revocation state.
