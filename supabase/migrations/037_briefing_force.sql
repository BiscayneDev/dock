-- 037: one-off "brief me now". A briefing_settings.force_until in the future
-- lets the next dinghy-briefing run send to that user outside the 7-10am
-- window and quiet hours; the cron clears it once the briefing is queued.
-- Set only by operators (service role). Mute still wins.
alter table public.briefing_settings add column if not exists force_until timestamptz;
notify pgrst, 'reload schema';
