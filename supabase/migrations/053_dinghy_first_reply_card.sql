-- A first-session contact card follows a real answer, never the opening text.
CREATE TABLE IF NOT EXISTS public.dinghy_first_reply_cards (
  chat_guid text PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dinghy_first_reply_cards ENABLE ROW LEVEL SECURITY;
-- Service role only. No anon/user-facing grant.
