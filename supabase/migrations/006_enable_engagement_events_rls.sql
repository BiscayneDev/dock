-- Enable RLS on engagement_events (was created without it).
-- This table is written/read only server-side via the service-role client
-- (src/app/api/cron/engagement), which bypasses RLS. No anon/authenticated
-- access exists, so enabling RLS with NO policies is correct: it locks the
-- table to the service role and closes anon-key exposure without breaking the
-- cron job.
alter table engagement_events enable row level security;
