-- Waitlist: each approved person is registered as a Photon (Spectrum) user and
-- gets their own assigned iMessage line from the shared pool. Store the Photon
-- user id and that line so the invite email and Dinghy's intro use the right number.

alter table public.waitlist
  add column if not exists photon_user_id text,
  add column if not exists dinghy_line text,
  add column if not exists intro_texted_at timestamptz;

alter table public.waitlist
  drop constraint if exists waitlist_dinghy_line_e164,
  add constraint waitlist_dinghy_line_e164 check (dinghy_line is null or dinghy_line ~ '^\+[1-9][0-9]{7,14}$');
