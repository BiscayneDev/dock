-- Admit queue: "let X in" without an admin web session or an owner text.
-- A row here is a request to run the existing waitlist invite flow for one
-- email. /api/cron/waitlist-admit (every minute, CRON_SECRET) claims pending
-- rows and calls runWaitlistInvites. The table is also the audit log.
-- Service role only; no anon/authenticated access.
create table if not exists public.waitlist_admit_queue (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  requested_by text not null default 'instinct',
  note text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed', 'skipped')),
  result text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists waitlist_admit_queue_status_idx on public.waitlist_admit_queue (status, created_at);
alter table public.waitlist_admit_queue enable row level security;
revoke all on public.waitlist_admit_queue from anon, authenticated, public;

-- Claim up to p_limit pending rows (oldest first), marking them processing.
create or replace function public.claim_waitlist_admits(p_limit int default 3)
returns setof public.waitlist_admit_queue
language sql security definer set search_path = public as $$
  update public.waitlist_admit_queue q set status = 'processing', processed_at = now()
  where q.id in (
    select id from public.waitlist_admit_queue where status = 'pending'
    order by created_at limit greatest(1, least(coalesce(p_limit, 3), 5)) for update skip locked
  )
  returning q.*;
$$;
revoke all on function public.claim_waitlist_admits(int) from public, anon, authenticated;
grant execute on function public.claim_waitlist_admits(int) to service_role;
notify pgrst, 'reload schema';
