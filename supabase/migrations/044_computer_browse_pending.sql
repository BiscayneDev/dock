-- Workstream H: logged-in browsing goes through the pending-action confirm
-- pattern, so the kind check widens to accept computer_browse proposals.
-- Payload: { task: text, urls: text[] } — the exact draft the server texts
-- is the task text plus the target domains.

alter table public.dinghy_pending_actions
  drop constraint if exists dinghy_pending_actions_kind_check;

alter table public.dinghy_pending_actions
  add constraint dinghy_pending_actions_kind_check
  check (kind in ('gmail_send', 'gmail_reply', 'gcal_create_invite', 'computer_browse'));

notify pgrst, 'reload schema';
