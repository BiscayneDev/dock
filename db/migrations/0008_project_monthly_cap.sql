-- Project monthly spend cap. Idempotent: safe to re-run. Applied with the Supabase management API, one transaction.
--
-- Invariants:
--   * null = no cap. Otherwise whole cents, 0 to $10,000 (checked here and in lib/briefs.ts validateCapCents).
--   * The existing owner-only policy on projects (0001) covers reads and writes of this column. No new policy.
--   * The cap window is the UTC calendar month; spend is read from ledger_entries (0007), not stored here.

begin;

alter table public.projects
  add column if not exists monthly_spend_cap_cents integer;

alter table public.projects
  drop constraint if exists projects_monthly_spend_cap_range;
alter table public.projects
  add constraint projects_monthly_spend_cap_range
  check (monthly_spend_cap_cents is null or monthly_spend_cap_cents between 0 and 1000000);

commit;

notify pgrst, 'reload schema';
