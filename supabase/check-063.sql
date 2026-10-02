-- Read-only checks after applying 063.
select tgname from pg_trigger where tgname = 'beta_allowlist_default_invites';
-- Brendan: grant 3 and remaining 3 (nothing redeemed yet).
select g.granted, public.user_invite_remaining(a.chat_guid) as remaining
from beta_allowlist a join user_invite_grants g using (chat_guid)
where a.chat_guid = 'any;-;+17193933639';
