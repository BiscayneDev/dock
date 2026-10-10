# Account erasure draft v2

Base f879f86. Still OFF. No live migration, provider cleanup or real deletion performed.

## Closed in this revision

- here.now independent inventory: GET /publishes?scope=all&limit=100, cursor pagination, require ownership=owned and exact hashed owner description. Discovers staged/orphan sites missing DB rows. Provider GET verifies owner immediately before DELETE; GET must return 404 after, and final inventory must be empty. No guessed slugs, no shared/workspace-site deletion. Contract: https://here.now/openapi.json and https://here.now/docs.
- E2B new computer and login sandboxes carry dinghy_owner SHA-256 metadata. Worker lists all metadata-matched running/paused sandboxes through the installed SDK paginator, checks every returned metadata tag, unions stored session/login IDs, static-kills each and re-lists for empty verification. Does not use manager.stop, which swallows failures.
- Real disposable PostgreSQL 14 with pgcrypto tested through two independent connections: uncommitted freeze locks block a concurrent chat writer; after commit the writer is rejected, other-user writer succeeds, FK recipe/run fixture hard deletion succeeds, other-user account remains. Reproducible harness included (requires disposable DB, pg module and pgcrypto). This is a real transaction test, not PGlite; it is not production load/concurrency proof.
- Legacy briefing/email/smart-alert/engagement/reminder/poll-trigger loops now check freeze, recipe execution checks owner, central Telegram API send/edit/action checks hashed Telegram suppression, standalone Spectrum sends check chat suppression. Google/Oura/Whoop/PayBox token use and model tool invocation checks already present. New DB Telegram fence also prevents stale Telegram identity recreation after deletion.
- Known FK children (recipe_runs, execution_agents, capability_runs, inference_usage) explicitly deleted first. Dynamic deletion verifies remaining user/chat owner rows, avoids views. Every external failure retains pointers and frozen job for retry.

## Default-off and policy

DINGHY_DATA_ERASURE_ENABLED remains unset. Migration 068 review-only: separate owner approval before apply. Legacy sandbox inventory requires DINGHY_ERASURE_LEGACY_SANDBOX_INVENTORY_VERIFIED before worker starts. This is an activation condition, never permission to guess an unknown sandbox owner. 30-day hashed user/chat/phone/Telegram suppression unchanged, disclosed in confirm warning; user policy decision pending. Receipt hash and completion status remain seven days; plaintext identity cleared on completion.

## Remaining blockers, honestly

1. Provider contract is source-verified and mocked tests pass, not authenticated provider inventory smoke proof. Live here.now account may differ; fail closed on malformed contract. Legacy pre-metadata orphan sandboxes cannot be attributed: need production inventory reconciliation or allow all old sandboxes to expire and verify none remain before enabling. Do not claim this was solved by tags added today.
2. Five-minute drain cannot recall already-started external actions. App checks and database fences stop new work/writes, but check-to-network-send race remains. No global network mutex spanning every provider send and confirm. Verify all callbacks, legacy routes and in-flight tools before promising no post-confirm external side effects. A frozen account may still receive a delivery started before confirmation; warning must reflect that.
3. Real test covers one freeze/writer race and a small FK fixture. Needs reversed race (write commits before freeze), all-live-schema FK dependencies, cleanup worker lease expiry/fencing, concurrent confirmations across chats, changed-owner UPDATE and multiple active provider calls. Worker lease is 10m without heartbeat: no activation until bounded cleanup/job fencing is tested.
4. Live schema/storage/provider backup retention and legal ledger decisions unverified. Exact table inventory beyond owner columns/JSON references must be reviewed. Phone identity mutability/shared-number ownership before phone-bound operator deletion remains a prerequisite.
5. Full typecheck exhausted local heap; CI required. Authenticated panel, confirm/status pixels and real cleanup not tested. Initial 390px component preview inspected, readable and no overflow. Completion receipt is only available while page holds token; reload loses it.

## Tests

Final local suite 99 files / 787 tests pass with maxWorkers=2, testTimeout=15000. 17 new tests cover explicit confirmation/hash/default-off, fail-closed freeze, external failure ordering/retries, Google explicit invalid_token vs arbitrary 400, here.now pagination/shared-user isolation/provider ownership/delete 404 evidence. Real PostgreSQL race/FK harness additionally passes. Synthetic PGlite harness retained as limited SQL control-flow fixture; requires updating telegram_id in its minimal schema before rerun.

## What this draft actually does

Signed-in same-origin 10m gate, exact DELETE MY DATA, random token hashed in DB. Atomic freeze/cancel, owner-keyed write triggers with advisory locks; queued external cleanup after drain, hard deletion and verification, status receipt with no recreated outbox/history. Google revoke only; other provider credentials removed locally and provider notes name consent still needing manual revocation. Deletes saved data, not source Gmail/calendar, recipients' copies, on-chain transactions or provider backups. No feature activation or merge permission inferred from build approval.
