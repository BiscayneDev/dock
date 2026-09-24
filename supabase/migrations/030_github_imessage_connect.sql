-- 030: in-thread (iMessage) GitHub connect.
-- connect_tokens.provider gains 'github'. Additive: widens the check only;
-- begin_connect / claim_connect_by_state / claim_pending_resume are already
-- provider-generic (migration 019).
alter table public.connect_tokens drop constraint if exists connect_tokens_provider_chk;
alter table public.connect_tokens
    add constraint connect_tokens_provider_chk check (provider in ('google', 'paybox', 'github'));
