-- 031: in-thread (iMessage) Oura + WHOOP connect.
-- connect_tokens.provider gains 'oura' and 'whoop'. Additive: widens the
-- check only; the connect RPCs are provider-generic (migration 019).
alter table public.connect_tokens drop constraint if exists connect_tokens_provider_chk;
alter table public.connect_tokens
    add constraint connect_tokens_provider_chk check (provider in ('google', 'paybox', 'github', 'oura', 'whoop'));
