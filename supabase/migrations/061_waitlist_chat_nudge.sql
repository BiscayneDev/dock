-- One in-chat nudge (~4h after the invite text with no reply) before the 36h email.
-- NOT applied by the patch.
alter table public.waitlist add column if not exists chat_nudge_sent_at timestamptz;
