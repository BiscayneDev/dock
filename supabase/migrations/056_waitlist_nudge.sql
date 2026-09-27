-- Prepared for one-time first-text nudge. No cron is scheduled until reviewed.
alter table public.waitlist add column if not exists nudge_sent_at timestamptz;
