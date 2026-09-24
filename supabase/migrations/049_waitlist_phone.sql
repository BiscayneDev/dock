-- Waitlist: phone number so Dinghy can text the invite from its own line.
-- Stored as E.164 (normalized in /api/waitlist). Nullable for rows that predate the field.
-- confirmation_sent_at records the waitlist confirmation email (Resend).

alter table public.waitlist
  add column if not exists phone text,
  add column if not exists confirmation_sent_at timestamptz;

alter table public.waitlist
  drop constraint if exists waitlist_phone_e164,
  add constraint waitlist_phone_e164 check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$');
