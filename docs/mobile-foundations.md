# Mobile, knowledge and isolated specialists

Draft implementation, not activated. The existing T3 phone environment is not
modified by this branch. This is not a replacement phone app.

## One actual path

The existing T3 app supports a local ACP command. `dock-acp` implements ACP v1
initialize/new/load/prompt/update/cancel without shell, filesystem or MCP tools.
It uses a mobile-purpose paired Dock device token. Dock session/turn endpoints
keep the canonical conversations/messages, recall existing owner/project memory,
retrieve a commit/path/line-provenanced Graphify snapshot and use the configured
roster agent/model. Reply, proposed tasks, canonical conversation memory and a
generic notice are committed together. Native T3 Connect publishes its own
completion activity. An outbox row is not proof a phone received a push.

`DOCK_MOBILE_INFERENCE_GATEWAY_BOUNDED` must remain unset until the gateway
enforces a source-grounded owner spending limit. A boolean flag is an operator
activation guard, not proof of metering or a grant to spend. The mobile inference path has no live monetary
provider enforcement yet. Draft execution holds do not activate that path.
Consumed mobile request bounds are160KB input,2048output tokens,zero SDK retries
and90s timeout. They are operational limits, not dollar caps.

`DOCK_MOBILE_ENABLED` is off unless explicitly set to `true`. Graph snapshots are
server-owned absolute files, never served as static content or committed as
fixtures. A separate owner-created mobile grant chooses device, project, agent,
repository keys and whether inference is allowed. Device purpose prevents the
mobile token from using the existing home-worker claim/infer/complete endpoints.
Revocation/narrowing is checked on reads, claim and completion.

## Tasks and specialized agents

The canonical roster and existing brief parsing protocol supply specialization.
A chat response may propose assignments, deliverables, budget and risks. ACP
shows them as not started and `/mobile` shows the same durable proposals. It does not treat model output or external source text as owner approval. Verified
owner instructions and standing grants can authorize their exact scope. The
review page and atomic decision RPC exist but remain disabled until the complete
controller/price/cleanup integration is configured and verified.

The isolated dispatcher requires a current durable owner decision, persisted
create/start intents, controller-inspected independent sandbox, no sibling
mounts, no controller credentials and an unprivileged workload before source
is transferred. It does not trust model- or worker-authored isolation claims.
Unknown create/start outcomes require reconciliation, not another purchase.
The controller adapter is not yet configured. A separate cleanup sweep protects
retained instances, verifies execution ownership, records delete intent and
confirms absence. A separate watchdog loop and durable cleanup store exist,
but deployment and external heartbeat supervision are not configured.
Migrations 0013/0014/0015 record lifecycle structure, service-only CAS transitions,
exactly-once canonical results and independent cleanup leases. They are not applied; migration0016 adds the disabled owner review endpoint. Local PostgreSQL concurrency and
sibling-result rejection proofs pass; live execution remains unconfigured. This is an unfinished activation
requirement, not evidence that generic ports enforce a real boundary.

Committed source export supports explicit granted paths at a pinned commit,
rejects symlinks/submodules/credentials, checks digests and creates a fresh git
object database plus worktree for each job. This avoids sibling commit/object
crossover. Independent sandbox identities are still required. Permissions on
two directories with the same UID do not provide a sandbox.

Shared context means owner/project memory and granted source knowledge, not
sibling scratch files, credentials or git history. Child lineage is retained by
Dock. Children inherit intersections of parent and specialist source grants and
cannot self-approve execution or promote private scratch state to shared facts.

## Knowledge coverage

`scripts/knowledge/build-snapshot.py` normalizes Graphify AST nodes/edges,
verbatim document chunks and committed file coverage into a versioned snapshot.
Verbatim chunks are not semantic extraction. Cross-repository dependency edges
come only from actual declared package dependencies. Full trees, unsupported
formats, missing SQL parsers, stale commits and unsearched outside documents
remain explicit in the manifest. Do not infer completeness from node counts.

Private repositories/documents and account-specific manifests stay outside this
public source tree. Exclude databases, ledgers, secrets, environment files,
credentials, generated dependency caches and execution scratch state. Current
indexing is partial, not full knowledge of every Shipyard source.

## Proof and remaining work

- Real installed T3 -> ACP -> production-built Next routes -> real local
  PostgreSQL RPCs -> canonical memory -> current Graphify -> same T3 thread
  passed with a fictional local owner/device and fictional OpenAI stream.
- PostgreSQL races: eight opens yield one session; eight claims yield one
  winner; changed payload rejected; reply/messages/memory/notice are atomic.
- Separate git databases and missing sibling commit proved with actual git.
- Phone push, live policy enablement, production DB/deployment and paid
  specialist execution have not been performed by this draft.
- Actual controller adapter, exact execution/budget/cleanup approval workflow,
  full knowledge coverage and actual phone notification verification remain.

Local proof programs are under scripts/proofs. They require local PostgreSQL
and fixtures; they must never target production. No proof script is a deploy or
migration approval. Transport journal records only IDs/status, never prompts or
secrets. Pending or failed inference is not automatically rerun.

## Controller readiness, still not activation

Fixed preparation runs against a fresh committed-source copy with isolated git
objects, sanitized Git environment and disabled hooks. Local real-git proof
passes. It stages shared context outside the git tree. Fixed launch consumes
that bounded context and stdin task text, checks the running managed-policy
fingerprint/acknowledgement and refuses a second launch-intent file. Launch is
not wired or live-proved against a qualified execution template.

The supported exact-result path is `t3_thread_read.recentRuns` through the
upstream MCP CLI. A one-minute read-only session is created with MCP subject,
used only for reading, and revoked. The fixed command has passed against a real
local T3 server. It binds exact instance/execution/thread/run and refuses missing
run status, truncated output or incomplete pages. CLI `thread show` alone omits
run status and cannot prove terminal completion.

Independent preparation-boundary comparison uses reviewed image digest,
template revision, default instance identity, expected disk mount, no public
ports and deny-all network state from the controller API. An actual reviewed
image record has not been configured. Workload inspection is only a preflight,
not independent proof. Deny-all also blocks managed models. Qualified scoped
model egress must be verified separately before launch, never inferred.

The controller reads actual managed-budget state before source placement and
requires zero monthly cap/consumption plus the exact approved one-time headroom.
Managed budgets do not cover compute or BYO provider keys. Compute terms must be
reviewed as rate, billing granularity, storage until deletion, deadline and
independent cleanup. A deadline is not a vendor hard dollar cap.

Draft monetary reservations serialize per execution in PostgreSQL. Duplicate
request IDs cannot authorize another serve, unknown charges keep their hold,
settlement is idempotent and source-grant revocation is checked on each hold.
The provider quote/settlement port additionally binds exact prompt digest,
model, output/attempt bound and request identity. No production quote issuer or
qualified provider path has been configured. Existing Shipyard fixed connection
holds can settle above the hold, so they are not a hard monetary ceiling.

Resumable per-tracked-file Graphify extraction avoids the large-repository
whole-graph timeout. Supplemental per-file relationships are structural, not
cross-file semantic resolution. Exact committed relative Markdown links are
separately labeled document relationships. Build caches are excluded from both
coverage and graph payload. The graph gateway retrieves actual one-hop neighbors
only within current repository grants. Private sources are ingested only from verified manifests outside this repository.
Coverage and unsupported formats remain explicit; outside-document completeness
is not established.

The standalone `/api/internal/mobile-maintenance` POST is separately authenticated
with a strong server secret, not a device/browser token. It is disabled by default,
protects explicit retained instance IDs, runs cleanup before result reads and writes
a durable heartbeat. Deployment scheduling and an external missed-heartbeat alert
are still required. It has no dispatch/create/start operation.

Owner review now has a session-gated exact packet page and atomic decision RPC
(migration0016 draft). It does not require asking again when a verified prior owner
instruction/standing grant covers the exact same terms; such authority still needs
a durable exact binding. The review activation guard defaults off. No phone/model
endpoint can author a review packet. Migration0017 stores maintenance heartbeats.

The fixed-model HTTP monetary adapter is implemented but intentionally unconfigured.
It requires an actual current upstream contract for single attempt, no hidden billed
steps, token-price upper bounds and authoritative usage. It sends non-streaming
fixed-model2048-token requests with no retry/redirect and settles usage under the
reserved quote. Test fixture contract values are not live vendor evidence. This
adapter does not make existing arbitrary auto-routing gateway traffic price-bounded.

## Beacon alignment correction

The original draft reused canonical recall but did not implement the Beacon
recall/distill/promote design. Reusing a table was not the complete shared-memory
system. The current disabled addition extends that same `memory_items` table:
legacy rows remain personal; agent working notes are private; distilled candidates
are excluded from recall until an exact owner/admin promotion creates a business
fact. Assigned agents share approved business facts, not sibling notes. Source
references and approval lineage are retained. Dinghy's database remains separate.

Migration0020, `lib/mobile/beacon.ts`, the bound recall path and the owner promotion
endpoint are draft code. Local PostgreSQL checks prove the scope/promotion races;
production-built mobile integration exercises the real bound recall RPC with
fictional credentials. Execution-bound specialist recall is consumed by dispatch and tested against
current decisions. The owner review page has passed local production-Next browser
approval through real PostgreSQL with fictional identity. Team membership/assignment
administration, execution-authenticated note/distill calls, production deployment
and actual phone validation remain unfinished. Do not enable Beacon from these component checks alone.

Build now runs a fresh mandatory TypeScript check in its own process before
webpack. The build uses a bounded heap, one compiler process and one page worker.
Both clean-cache and warm-cache `npm run build` completed locally after this
change. Type errors fail before webpack; Next's duplicate typecheck is skipped
only by the wrapper after that successful fresh check. Graph files are external
runtime inputs, not imported bundles. The graph still has a measured cold-process
RAM cost and is not production-sized by assumption.

The configured `DOCK_PUBLIC_ORIGIN` pins the owner decision origin when a trusted
reverse proxy rewrites the internal URL. Forwarded headers never choose it.
`/memory/review` renders exact candidate text; only the owner's authenticated
POST can promote that candidate. Local browser proof is
`scripts/proofs/beacon-owner-ui.mjs`, requiring an explicitly installed Puppeteer
package and local Chrome. The fixture session is not a live owner grant.

Execution-scoped Beacon tools now have a fixed HTTP and MCP surface:
`memory_search`, `memory_note`, `memory_distill`. The durable execution chooses
owner/project/agent; requests cannot override identity or promote facts. Local
production Next -> real PostgreSQL proof exercises private note, candidate and
recall through the capability endpoint. Two-user RLS proof also checks business
membership and revocation. These components are not yet registered with a live
qualified specialist provider. A tested MCP server file is not an installed tool.

A local installed Pi CLI has now registered the fixed stdio MCP server and
successfully discovered `memory_search`, `memory_note`, `memory_distill` through
its actual MCP connection. `scripts/proofs/pi-memory-registration.mjs` reproduces
this with an explicitly installed Pi binary and fictional temporary environment.
No model call, live provider inference, remote image install or runtime isolation
is proved by tool discovery. The controller cannot activate from this test.

The installed Pi provider also completed a real local tool-calling turn using a
fictional OpenAI-compatible model server: it selected the registered memory-note
MCP tool, made exactly one private-note call, then completed on its next model
turn. `scripts/proofs/pi-memory-turn.mjs` reproduces the process. Both HTTP
services are fixtures. This does not make the plain-text bounded model gateway
OpenAI/tool-compatible; that live transport and its price contract remain missing.

The disabled execution gateway now also accepts bounded text/function chat requests
at `/api/internal/execution-model/v1/chat/completions`. It quotes the complete
canonical message/tool schema, refuses unknown billing fields, reserves once,
uses one nonstream upstream call and settles before emitting compatible chunks.
The current Pi process proof consumes that structured adapter with two fixture
reservations and settlements around a private memory tool call. Actual production-built Next capability/quote/hold/settlement has passed against
real local PostgreSQL and a fictional TLS upstream, including duplicate-request
refusal. Live upstream pricing/attempt/tool-schema token guarantees are not proved. No fixture contract authorizes real provider traffic.

The optional `PI_BIN` path in `scripts/proofs/next-mobile.mjs` now runs the actual
Pi process through the actual Next structured gateway, real local PostgreSQL
capability holds/settlements, and fixed memory MCP. It checks exactly two settled
model calls and one persisted private note. The TLS model and its price contract
remain fictional. This is not live upstream, runtime-isolation, or phone proof.

Business rows contain only the approved fact and business approval metadata, not
private agent/source identifiers or source-memory links. The private candidate
keeps the promotion link instead. A real two-user PostgreSQL test checks both the
member-readable row's absence of private provenance and private-side lineage.

Private child working notes are keyed to the durable execution, not just the
reusable specialist role. Same-role children cannot recall or distill each
other's notes. Context replay uses that same exact execution identity; supplied
parent/sibling scratch fields are not inherited. Execution context fails closed
rather than falling back to broad personal recall when Beacon is disabled.
Completed specialist output returns to its owner's canonical conversation once,
but is not automatically inserted into personal recall or business memory.
Sharing a distilled fact still requires the exact owner/admin promotion.

A separate optional `shipyard-stage-quote` transport consumes request-bound
three-stage quotes while preserving `model: auto` and Jev routing. It does not
reuse the single-stage fixed-model contract. It verifies exact request digest,
stable revision, quote expiry/identity and authoritative all-stage settlement;
Dock reserves its own execution budget before serve. Unknown outcomes keep the
hold and never retry. This depends on the unactivated inference draft at
https://github.com/BiscayneDev/shipyard-inference/pull/51 and actual operator stage
contracts, none configured here. The cross-repository local proof uses actual
Dock transport and inference gateway/router, with fictional prices/providers.
