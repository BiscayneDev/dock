-- Chat-taught workflows: a second capability kind on the same grant model, and a
-- confirm-with-y draft kind for saving one. Steps live in scope (plain text the
-- user was shown and said yes to); no secret is stored for a workflow.
alter table public.user_capabilities
  drop constraint if exists user_capabilities_kind_check;
alter table public.user_capabilities
  add constraint user_capabilities_kind_check
  check (kind in ('browser_session', 'workflow'));

alter table public.dinghy_pending_actions
  drop constraint if exists dinghy_pending_actions_kind_check;
alter table public.dinghy_pending_actions
  add constraint dinghy_pending_actions_kind_check
  check (kind in ('gmail_send', 'gmail_reply', 'gcal_create_invite', 'computer_browse', 'google_disconnect', 'workflow_save'));
