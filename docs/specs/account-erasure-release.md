# Account erasure review patch

Base f879f86. No live migrations, account changes, token revokes, sandbox kills or deletes performed.

## Default-off behavior

DINGHY_DATA_ERASURE_ENABLED is OFF unless explicitly 1. Profile panel, APIs, cron and app read guards are inert while OFF. Migration 068 is REVIEW ONLY, requires separate owner approval. Applying it installs DB guards and service-only cleanup RPCs; it must be paired with reviewed application rollout. Do not apply automatically. Cron exists but returns off with flag unset. DINGHY_ERASURE_HOST_INVENTORY_VERIFIED must be 1 before worker starts. It is a release-attestation flag, not a substitute for actual hosted inventory validation.

## Implemented

Signed-in same-origin two-step request/confirm API. Exactly DELETE MY DATA, random 256-bit token hashed server-side, 10-minute gate, replay rejection. Text intent explains the difference from soft memory clear; destructive chat confirmation is deliberately not allowed. Web receipt is kept only in component state and sent in a header, never URL or localStorage. After account deletion it can retrieve narrow status for seven days. Keep the page open; reloading loses the receipt. No completion text goes through the outbox or recreates history.

Confirm atomically freezes bound user/chat/phone keys, disables schedule settings, cancels pending drafts and queued outbound texts. Durable job and advisory-lock write triggers prevent post-freeze INSERT/UPDATE to owner-linked tables, including SECURITY DEFINER RPC writers. Triggers inspect both OLD and NEW ownership. Five-minute drain before cleanup; job lease makes external retries serial, but a long-running cleanup beyond ten-minute lease is not supported and must remain blocked until bounded behavior is established.

Worker runs one job per ten-minute cron. Revokes all stored Google account refresh/access credentials before deleting them. Other providers are local-disconnect only and named in status. Deletes every known live/sleeping/session-login sandbox through E2B static kill, not existing manager.stop (which hides all errors). Deletes known hosted pages, including soft-deleted library files, and recursively removes private Storage user objects. Any external error retains job/pointers and marks blocked for retry, not complete. DB finish hard-deletes owner-column-linked tables, handles non-cascade user records and chat-id connect tokens, removes phone-bound waitlist/admit queue rows, verifies owner columns empty, deletes user and identity bindings. Completed job clears plaintext owner/chat IDs and expires seven days later. Digest fences remain 30 days, then cron removes them.

## Mandatory rollout blockers

- Not full "delete everything" proof yet. No verified here.now owner listing exists here; orphan sites whose DB save failed cannot be enumerated. DINGHY_ERASURE_HOST_INVENTORY_VERIFIED must remain unset until a real independent inventory and cleanup route exists. The flag cannot make an unimplemented inventory complete.
- App guards check before tool invocation, provider token access and some sends, not every transport/provider route. Already-started actions cannot be cancelled; external provider requests can race the freeze. DB write fences prevent retained-row resurrection but do not pull back network sends. Audit Telegram sends, old recipe/cron delivery, connect callbacks, standalone spectrum stream and all provider paths before enabling. A five-minute drain is not proof all work has stopped.
- Trigger lock/isolation behavior tested synthetically in one session, not simultaneous production PostgreSQL transactions. Multi-table lock ordering, update-owner changes, external job lease expiry, RPC nested triggers and deadlocks require concurrency tests. Dynamic table discovery must be checked against live schema, FK dependencies, public views and extension schema naming. It ignores tables with only arbitrary JSON or other ownership keys; these require explicit inventory.
- Live Supabase schema/storage, provider backup policies, retention/legal ledgers, provider consent revoke and real native sessions remain unverified. No authenticated production cleanup performed. pgcrypto is expected in extensions; validate before apply. Existing privacy policy and retention promise need review.
- E2B kill removes a known sandbox; orphan sandbox IDs not recorded cannot be found. Temporary capability attempts >=1000 block rather than silently truncate. Stored session IDs require real provider verification.
- Digest phone/chat identifiers are pseudonymous, not anonymous. They remain for 30 days and block reconnection during that time, including fresh signups. This is explicitly disclosed in the confirm warning; retention choice requires owner's review before rollout. Identity handle mutability and shared phones require verification before using phone-based operator cleanup.
- Status receipt persistence is intentionally temporary; no reliable post-reload completion mechanism. Real flow/UI/network screenshots remain unverified. Screenshot only renders actual component with preview styling.

## Verification performed

13 Vitest tests: defaults OFF; direct-intent scope; exact confirmation; invalid/replayed gate; fail-closed freeze read; token hashing; cleanup completion ordering; provider/sandbox/page/storage failure blocks hard delete, retries succeed.

Full test suite: 98 files, 783 tests passed using maxWorkers=2 and testTimeout=15000. Initial suite's single spectrum handler import timeout at default 5000ms disappeared at 15000ms; not a failed assertion. Typecheck exhausted 1.2GB heap, so CI typecheck remains required.

Synthetic migration executed in PGlite with a minimal ownership schema: confirmation hash rejection, freeze/write rejection, other-user isolation, claim and hard delete, non-cascading inference usage removed, completed job PII cleared. Stub digest uses MD5 to emulate extension signature, not production crypto; it tests SQL control flow only. No pgcrypto or true multi-connection races tested. Companion harness handed off separately.

## Merge vs activation

This is an open-only draft implementation. Do not describe it as ready full deletion or enable flags. No merge approval inferred from "build it". Separate migration/activation approval only after inventory and race blockers above are closed.
