-- Start-page Google connect: store Dinghy's first look and deliver it as the reply to the first inbound text.
-- Photon's shared pool rejects outbound-first, so the first look waits in the row until they text.
-- first_look_text is Google-derived: it is cleared the moment it is claimed for delivery.
alter table public.waitlist add column if not exists first_look_status text
  check (first_look_status in ('pending', 'ready', 'empty', 'failed', 'sent'));
alter table public.waitlist add column if not exists first_look_text text;
alter table public.waitlist add column if not exists first_look_at timestamptz;
