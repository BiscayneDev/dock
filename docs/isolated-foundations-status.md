# Dock foundations: reviewable draft, not ready for production

Branch: `feat/isolated-task-runs`, draft PR #13.
All new coding execution remains disabled by default. No merge, production
migration, cutover, paid inference, Apple enrollment or native distribution is
part of this checkpoint.

## Capability matrix

| Foundation | Implemented and checked locally | Not established / dependency |
| --- | --- | --- |
| Mobile client | Expo client with task board, messages, pairing-code connection, readable approval proposals; unavailable details disable approval. Web rendering and fictional HTTP fixtures checked. | No native iOS device build, push delivery, TestFlight distribution or production pairing migration applied. Business-email OTP reached Expo's new-account username step; signup deferred. |
| Isolated coding | Home-node adapter; private repo seeded only from a selected committed base snapshot; linked worktree and per-task branch. Real Linux bubblewrap child processes tested concurrently. No sibling objects/history, host credentials or network route. Results require review; no host ref/object import. | Production coding inference returns 501. Docker/Podman launch is implemented but not runtime-tested; Apple container path unsupported. No production host has been configured or tested. |
| Control-plane route | Experimental home-run payload can be validated, queued, returned by device claim and routed through executor. Known money actions gate first. Malformed isolation payload cannot fall back to ordinary execution. | Fictional HTTP integration uses a fixture server, not a production Next/Supabase/gateway coding run. Real metered tool-call adapter remains disabled. |
| Inference cost control | Strict tool-call protocol parsing; atomic call reservation SQL proven in throwaway Postgres, with concurrency, duplicate and lease tests. | No verified upstream per-call dollar upper bound. Reservation is preparation, not a claim that provider cost is capped. No migration applied to production. |
| Shared Graphify context | Official graphifyy 0.9.102, deterministic local parsing, scrubbed environment. Scoped two-repo slice: 30 committed files, 319 nodes, 501 edges, including 64 Markdown structural nodes. Bounded source-linked context is consumed by builder brief. | Not all Shipyard repos/docs. Markdown structural indexing is not semantic document analysis. Broader 599-code-file trial timed out. No hosted graph service or model extraction. |
| Shared memory and specialists | Task fact proposals remain separate from host-reviewed facts. Source-linked proposal tests and exclusive promotion tested. Builder/reviewer/scout brief templates. | No complete multi-agent scheduler, review queue UX, automatic refresh service or full persistent agent-memory product. Role templates are not independent running specialists. |

## Boundary and result semantics

The task's repository and linked worktree are private copies of the selected
base snapshot. Its Git history does not include other branches or earlier
history. This sacrifices shared-history queries inside execution deliberately:
shared source context is supplied separately from an explicit committed-source
manifest. Private sibling execution and credentials do not become shared memory.

The host does not execute Git commands on agent-modified metadata after a run,
import objects, apply patches or advance owner refs. A successful child means
`review_required`, not merged, deployed, tested by the user or approved to spend.
The current ordinary run completion transport records success for producing
that review artifact; its summary states that review is still required. Artifact
retention and a complete review/download UI remain future integration work.

Task-authored findings cannot promote themselves into shared facts. Promotion
is a separate host-review operation and is not exposed as a sandbox tool. The
local implementation records review; a production review UI still needs its
own authenticated action and source-verification workflow.

## Gateway dependency: actual owning source

Read-only inspection used Shipyard Inference main commit
`c16fdf921dd5a41db39f90904aa1239d4151d43f`.

- `src/gateway/connection-budget.ts` lines 48-53: `holdUsd` is an amount held
  before serving, with the explicit comment: "Actual cost above this is still
  settled". Lines 79-86 reserve that fixed hold. Lines 164-173 add actual cost
  at settlement, rather than clipping to the hold.
- `src/gateway/spend.ts` lines 120-129 documents accepted in-flight overshoot in
  the project cap implementation.
- The server reserves before serving, but these controls do not establish a
  per-request cost ceiling across provider calls and failover.

Observed source pages:

- https://github.com/BiscayneDev/shipyard-inference/blob/main/src/gateway/connection-budget.ts
- https://github.com/BiscayneDev/shipyard-inference/blob/main/src/gateway/spend.ts
- https://github.com/BiscayneDev/shipyard-inference/blob/main/src/gateway/server.ts
- https://github.com/BiscayneDev/shipyard-inference/blob/main/test/connection-budget.test.ts

Narrow proposed gateway change, not implemented here:

1. An authenticated per-request dollar ceiling and idempotency key.
2. A provider/model/input/output upper-bound calculation before serving;
   refuse when the bound is unknown or exceeds the reservation.
3. A single reservation covering all retries/failover, with actual settlement
   and fail-closed handling of missing cost data.
4. A verifiable response identifying the enforced ceiling and request ID so
   Dock can match it to its atomic run reservation.

An estimate, max_tokens setting, or after-the-fact spend ledger is not a
substitute. Real paid coding inference stays disabled until this dependency is
resolved. No Shipyard repository mutation was made.

## Reproducing the local checks

- `node --experimental-strip-types --test 'test/*.test.*'`
- `node --test 'node/dock-node/test/*.test.mjs'`
- `npx tsc --noEmit`
- `npx next build`
- `python scripts/e2e/prove-coding-reservations.py` in an environment with
  pgserver and psql, using only a throwaway database.
- Local graph build and scope limits: `scripts/knowledge/README.md`.

At this checkpoint main tests are 245 total, 243 pass, 2 skip; home-node tests
are 33/33. These results do not establish production availability or native
readiness. The draft remains experimental and uncleared.
