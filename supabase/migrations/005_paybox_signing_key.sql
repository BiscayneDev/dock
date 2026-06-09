-- Paybox in-process wallet signing key (pbxk1.)
-- Stored AES-256-GCM encrypted on the user's paybox token row. Enables
-- non-custodial wallet sign / swap via @paybox-sh/sdk; the MoonX secret never
-- reaches Dock. Nullable — absent means sign/swap stall at pending_signature.
alter table oauth_tokens add column if not exists signing_key text;
