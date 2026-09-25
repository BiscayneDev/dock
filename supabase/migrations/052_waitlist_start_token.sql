-- Opaque invite link key. Only the server role may resolve it to a member's line.
ALTER TABLE public.waitlist ADD COLUMN IF NOT EXISTS start_token text;
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_start_token_key ON public.waitlist (start_token) WHERE start_token IS NOT NULL;
