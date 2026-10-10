# Data portability: export-first review patch

Base: main 626b7d6. No production data read or deletion performed.

## Release gate

DINGHY_DATA_EXPORT_ENABLED defaults off. Keep it off until the exact exported columns are checked against the live Supabase schema, private one-to-one transport is verified, and real ZIP attachment delivery works. The current transport interface exposes no participant/group field. Handle equality is checked but is not proof of a one-to-one audience. The existing handler also updates identity.handle before intent handling; this is not an independent identity binding check. The export must not be enabled for group chats. These are rollout blockers, not proven properties.

The native ZIP has no public URL and is not stored in the files library or any third-party page host. It contains table JSON, saved page bodies as individual Markdown files, manifest and README. All reads have explicit column lists and owner equality filters. Chat history uses keyset pagination; any read failure aborts delivery. It is a bounded read, not a transaction snapshot. Reject over 12 MiB rather than return an incomplete archive. No destructive mutation, LLM call or migration.

## Credential limitations

No credential columns, hashes, embeddings or raw tool JSON are selected. Known credential patterns in content are redacted recursively. A password in ordinary unlabeled prose is indistinguishable from user data: generic text redaction cannot prove "never include secrets". Do not promise that guarantee or enable rollout until a content-safety decision is made. Options: conservative review/quarantine of suspected content, user-authenticated download with a warning, or a narrower safe-memory export. No system credential is decrypted or read.

## What is not exported yet

Provider sandbox filesystem, originals of incoming attachments, arbitrary execution-agent history/tool logs, provider-connected source email/calendar data, transient queues/pending action bodies, waitlist/operator rows, referrals and some onboarding diagnostics. Recipe trigger_config is omitted because arbitrary JSON may carry secrets. Saved file Markdown survives expired links; binary original exports need a separate collector. README lists these omissions. This is not "everything Dinghy holds" yet.

## Complete deletion design (not implemented in this patch)

Do not reuse forget_all_user_memories: it supersedes facts and is reversible. A full erase needs a durable, retryable state machine:

1. Authenticated one-to-one request; short-lived gate bound to user and verified chat. Show exact coverage and provider limitations; require DELETE MY DATA, not a generic yes that could approve another draft. Export remains available before confirmation. Group chats must not trigger erase.
2. Atomically freeze account and all verified chats, disable recipes/briefing/email watches, cancel drafts/reminders/outbox. Create minimal temporary cleanup job, not a copy of private content. Acquire lock shared by ingress/cron/tool mutations. A deletion state check only at inbound entry is insufficient: already-running model/tool calls may still send or write. Every tool boundary, save, enqueue and dispatch must recheck generation/state, with DB write guards against races. Do not claim previously-started provider side effects were cancelled.
3. Gather all identities first. Preserve IDs only until cleanup succeeds. Remove external here.now sites, including soft-deleted library rows; enumerate actual owned sites by owner tag to catch sites whose DB save failed. Kill every live/sleeping computer_sessions sandbox AND temporary capability_connect_attempt login sandboxes. Delete saved Storage objects recursively by exact user prefix, not signed URLs. Errors retain retry jobs and block a success claim.
4. Transactionally hard-delete chat-keyed records: spectrum_messages, dinghy_profiles, conversation_summaries, chat-owned memories/reminders/inference_usage, dinghy_pending_actions, memory_wipes/interviews/first_reply_cards, dedupe/rate/outbox/gate, web_login_codes, connect_tokens.chat_id, beta_invites.created_by_chat, invite grants and run stages. Many do not cascade from users. Handle waitlist/admit queue only by trusted phone/account linkage; email matching alone is not ownership. Token hashes/magic sessions need invalidation without exposing them.
5. Remove user-keyed records and user row after explicit deletes of inference_usage (ON DELETE SET NULL would preserve attribution metadata), chat-owned rows, and pending_actions (no FK). FK cascade removes OAuth tokens, memories, recipes/runs/agents, capabilities/runs/connect attempts, preferences/location, plans/files, spend, briefing, signing links, sessions/settings and identities. Validate the live schema for tables not in migrations before calling this complete. Disconnecting local credentials does not revoke provider consent automatically; call supported provider revocation and report failures.
6. Verify no remaining rows/objects/sites/sandboxes; retry on partial failure. Send a minimal completion once without recreating transcript/outbox/history. Do not keep raw user/chat IDs permanently to remember deletion. A temporary keyed suppression fence may be required to reject late webhook retries; disclose purpose/retention and remove it after bounded retry windows. A future user-initiated signup is a separate identity lifecycle.

## Honest limits to show before confirmation

Already-delivered phone/email attachments, recipients' downloads, third-party source accounts, on-chain transfers and provider backups cannot be recalled. Do not invent backup retention windows; confirm Supabase/E2B/Photon/here.now current deletion behavior. Existing public privacy policy says deletion within 30 days; reconcile the product wording only after the process is proven. Business/legal ledger retention needs an owner decision, not silent exclusion.

## Test plan before delete rollout

Cross-user/chat/guest isolation; explicit vs quoted/attachment confirmation; gate expiry/replay; multi-chat ownership; failed external cleanup and retries; more than 1000 rows/objects; soft-deleted file rows; live/sleeping/login sandbox cleanup; every non-cascade table; already-running cron/tool and delayed webhook/outbox retry; no resurrection; deleted local credentials and provider revoke failures; completion send must not write private history back. Dry-run on synthetic identities first. No real-user deletion without their reviewed confirmation.
