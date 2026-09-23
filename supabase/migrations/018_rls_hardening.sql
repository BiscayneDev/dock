-- Security hardening (found 2026-09-22 during the PayBox build).
--
-- Four public tables had RLS disabled while Supabase's default grants give
-- anon/authenticated full table privileges. Anyone holding the (public)
-- anon key could read every Dinghy iMessage transcript, read connect
-- tokens, and INSERT into spectrum_identities — i.e. bind their own chat
-- guid to someone else's user_id and inherit that user's Gmail/Calendar
-- (and soon wallet) tools.
--
-- All server code uses the service-role key, which bypasses RLS, so
-- enabling RLS with no policies closes anon/authenticated access without
-- touching the app. The browser Supabase client (src/lib/supabase/client.ts)
-- is not imported anywhere.

alter table public.connect_tokens enable row level security;
alter table public.spectrum_identities enable row level security;
alter table public.spectrum_messages enable row level security;
alter table public.memories enable row level security;

-- claim_pending_resume is SECURITY DEFINER (bypasses RLS) and was
-- executable by anon. Server-only.
revoke execute on function public.claim_pending_resume(text, int) from public, anon, authenticated;
grant execute on function public.claim_pending_resume(text, int) to service_role;

-- Outbox claim returns message bodies; server-only as well.
revoke execute on function public.claim_spectrum_outbox(int, int) from public, anon, authenticated;
grant execute on function public.claim_spectrum_outbox(int, int) to service_role;
