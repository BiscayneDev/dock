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

`scripts/proofs/linux-private-root.py` also exercises two actual concurrent local
Linux namespace/private-root workloads, capability dropping, no-new-privileges,
read-only runtime mounts, denied outside-network access and independent writes.
This is local negative containment evidence, not a qualified remote image or
functional scoped model egress. It does not supply a deployed watchdog or prove
the Agent37 boundary. There is no automatic remote activation from this proof.

### Functional local scoped relay proof

`DOCK_PROVE_SCOPED_RELAY=1 python3 scripts/proofs/linux-private-root.py`
now runs two concurrent private namespace roots with independent Unix model
sockets. Each network-disabled task receives its own fictional model response;
substitution of the execution scope or an external URL is refused. The sibling
socket, sibling git objects/worktree, controller marker, host paths and external
network remain inaccessible. No capabilities or new privileges are available.
The controller relay fixture contains no real credential and makes no provider
request. Roots are removed after the proof.

This proves the local mechanism for mediated access while task networking stays
off. It does not qualify the remote Agent37 template, install this relay in the
actual executor, establish provider-dollar controls or deploy a watchdog.


### Actual remote qualification, November4

Two user-approved temporary instances from pinned revision1 were concurrently
alive; their probes ran sequentially. Both reproduced the runtime0500 startup
bug, then passed the fixed owner-admin repair and nonroot T3 startup/running
managed-policy check. Each could edit its own fictional source, could not read
the sibling path/private git object, had no alternates or controller key in its
environment, no sudo, and could not connect to an outside IP. Each fictional
Unix relay returned only its own scope and refused scope/URL substitution.

This is negative evidence for those repaired disposable hosts, not a full
host-security audit, simultaneous workload proof, original-image attestation,
live provider egress, paid-model proof or actual phone integration. API budget
field was null despite requestedzero; do not call provider budgetzero verified.
Networkdenyall stayed in force throughout. Test evidence was exported and
early cleanup was handed to the independent cleanup owner with fixeddeadline.
No retainedphone action was taken.

`infra/execution-private` now carries the tested ownership/permission repair
as an explicit build step and nonroot real T3 smoke test. This candidate is
unpublished and unqualified until its own immutable build and remote proof.
The candidate policy now fixes dockrelay/auto and a private-socket Pi wrapper, not the managed default. This source binding is not a remotely installed qualified Shipyard relay.

### Actual local T3/Pi scoped relay integration

`node scripts/proofs/t3-scoped-relay.mjs` now runs real installed T3v0.1.7 and
Pi through the reusable loopback/private Unix relay and existing bounded
controller gateway. The controller fixes execution identity, preserves
`model:auto`, reserves the exact fictional quote and settles before releasing
JSON or SSE. One actual T3 run completes with one fictional provider call and
one settlement. T3 emits73function schemas; the bounded contract now accepts up
to128 while retaining160KB canonical input and2048output-token limits. Regression
tests refuse129tools, oversized schema/body and output-limit overrides.

`infra/execution-private` includes the fixed `dockrelay/auto` wrapper/config,
not a provider key. `infra/maintenance` contains a runnable maintenance-only
worker and source-only supervisor unit. Both remain uninstalled/unqualified.

These are local compatibility proofs, not actual iOS pixels, paid-provider
requests, deployed independent missing-heartbeat alert or remote private-socket
mount proof. The retained working phone is untouched. The upstream immutable
price contract remains a separate blocker; receipt settlement alone is not a
pre-dispatch dollar guarantee. No production activation follows from these tests.

The combined local Next/Postgres proof now also routes actual Pi model traffic
through this reusable Unix relay before the real capability endpoint. Its
private note persists and both tool-turn model calls settle in Postgres before
output; canonical conversation replay/result-once and temporary reader revoke
checks still pass. `PROOF_PRIVATE_RELAY=true` enables this optional proof branch.
Identity HTTP shim and upstream model remain fictional. A separate scoped
memory capability is still installed for the memory endpoint in this branch.

`node scripts/proofs/watchdog-process.mjs` starts the actual maintenance worker
as a separate process, kills a fictional workload, confirms another sweep and
heartbeat at the actual30second cadence, then takes the fictional HTTPS endpoint
down and observes failure alert output. This proves local process independence,
not an independently deployed controller or external missing-heartbeat alert.
No real provider deletion or lifecycle grant occurs in that proof.

The combined proof can open real local T3 at a390x844viewport using a short-lived
read-only local pairing token and inspect the actual Dock conversation reply in
the T3 web UI (`PROOF_T3_SCREENSHOT` output). Its pixels show the canonical-memory
and graph reply with the Dock provider selected. This is a responsive-browser
proof, not actual native iOS delivery, push or connection to the retained phone.
The optional screenshot branch refuses success unless the exact reply is present.

A separate read-only heartbeat monitor now reports stale/missing/source-unavailable
states and deduplicates unchanged alerts, with recovery tests. No external alert
destination, deployment or lifecycle permission is supplied by this source.

The latest combined private-relay variant also places Beacon behind a separate
fixed memory Unix socket. Actual Pi persists one note through socket→controller
capability→Next→Postgres and settles two model calls, with no execution bearer
in its environment. Image wrapper now explicitly registers scoped Beacon MCP
in fresh state; its policy no longer disablesMCP. Candidate remains unbuilt and
remote private-socket/mount enforcement unqualified.

`node scripts/proofs/private-wrapper-namespace.mjs` joins local containment with
actual candidate wrapper consumption. Two concurrent isolated local roots each
run the fixed Pi wrapper, private model+memory sockets, fresh Pi config and
scoped Beacon MCP registration. Each completes two fictional model settlements
and one own private note. Outside networking and host/sibling paths are absent;
effective capabilities arezero and no-new-privileges is asserted before wrapper.
NamespaceUID0 maps to hostUID1000, unlike remote finalUSERnode. The local runtime
read-only mount differs from the unbuilt image, so this is not remote image,
remote private-mount, paid-provider, live lifecycle or nativeiOS qualification.
The normal Pi MCP extension must load; `--no-extensions` is not compatible with
this Beacon registration (candidate locked policy does not disable extensions).

### Supported remote transport correction

External controller-owned Unix socket injection is not a documented Agent37
capability. The candidate no longer relies on it: model/memory sockets live
inside the task, connected to a private request spool. Controller reads/replies
through documented authenticated exec while outbound networking stays denied.
This needs no new provider/account/platform, no workload account credential and
no externally bound application listener. Template preview URLs make an empty
public_ports array insufficient as proof of no reachable service.

Controller fixes host/execution identity from inventory, verifies its private
capability against that execution and inserts an exclusive durable mailbox claim
before dispatch. The task spool is untrusted input. A claimed/unknown request is
never dispatched again; durable skipped IDs prevent an old request blocking the
queue. Fixed exec commands use bounded data, safe directory/file descriptors and
no-follow opens. Input is capped80000bytes to stay below exec's512KB output cap
even after JSON escaping; reply cap is200KB. Actual task-local loopback bridge
requires a random local token, not a provider/controller key.

Two concurrent isolated actual Pi wrappers pass using this spool candidate.
Generated exec commands run locally and reject symlink roots; adapter tests
refuse sibling host binding before exec. Remote API calls remain mocked, durable
mailbox migration is draft and worker deployment is not active. Operational
remote proof, upstream hard-dollar bounds, independent alerting and nativeiOS
remain unverified. The earlier injected-socket proof describes local mechanics,
not the current remote transport design.
