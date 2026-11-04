# Minimal owner-task release, disabled and independent of PR13

This branch starts from main6eecc11. It does not import experimental PR13 or PR15,
custom mobile shell, Graphify, shared-memory promotion, host worktrees or patch
application. The one path is owner task -> one private T3 execution -> exact stored
text result -> delete execution. T3 remains the phone front door.

## Implemented

- Owner-session-only GET/POST `/api/t3/tasks`, default501 unless DOCK_T3_TASKS=on.
  Strict project/repo/base-SHA/brief/deadline/request-ID input. No machine/mobile
  token fallback. Postgres independently derives owner/workspace/project.
- Dedicated `t3_owner_tasks` persistence, not ordinary cloud/home queue. Existing
  workers cannot accidentally consume the new task. Owner SELECT RLS, service-only
  claims/transitions, request idempotency and unique private execution ID.
- Transactional version CAS across provisioning/ready/launching/launched/result/
  cleanup/deleted. Exact thread/run and bounded result artifact remain in Dock
  after deletion; outcome and lifecycle are distinct. No automatic retry of an
  uncertain create/launch. Cleanup-only takeover handles lost worker leases.
- Disabled private worker with backend authority callback before claim/create,
  periodic heartbeat, policy verification before launch, exact response matching,
  result archive before cleanup, delete+inventory reconciliation and final
  compute settlement check. Stable task names find instances after lost create
  responses. Unknown deletion remains cleanup_due for the separate watchdog.
- Backend Agent37 adapter, no workspace key in instance commands/env/phone. Creates
  zero public ports; caller must supply a reviewed `dock-t3-*` policy template and
  explicit managed-model credit. No provider account creation or funding hidden.
- Registered-source allowlist exports only regular committed files. Private repo
  initialized from that selected base and private linked worktree. No parent .git,
  earlier history, sibling worktree, shared object store or broad GitHub credential.
- Fixed bootstrap checks root-owned policy read-only to agent, copies image settings,
  starts pinned T3 and verifies readiness. No custom template is registered yet.

## Real local proof, fictional inference and provisioning

`python3 scripts/e2e/prove-t3-owner-tasks.py` runs scratch PostgreSQL roles/RLS,
8-way claim race and CAS/cleanup recovery checks. It then runs actual T3.0.1.7/Pi1.5.0
in a private Linux namespace with `/etc/t3code/policy.json` read-only, real active
`approval-required` managed ceiling and pinned Pi settings. Policy write attempt
is refused. `t3 policy show` confirms the running server loaded that policy. No
injected verifier. The worker launches real T3 through its CLI and stores the
matching run's result in real scratch Postgres, then reconciles fictional local
execution deletion. Owner read still returns the saved review-required artifact.
The only model endpoint is fictional loopback. This uses no paid resources.

This proves managed startup and persistent task/result transport, not Agent37
image acceptance, production Supabase transport or iPhone rendering. Namespace
proof is not an audit of vendor isolation. The previous approved Agent37 pilot
proved its standard-image model/tunnel path, then deleted both instances; that
pilot did not have this administrator-owned managed-policy image.

## Exact activation remaining

1. Review/approve this main-based draft, narrow migration and deployment. Feature
   staysOFF. No need to merge PR13 or PR15. No automatic deployment performed.
2. Build/pin/review/register the included private-image recipe with administrator-
   owned T3/Pi policy and non-root execution; then verify Agent37 accepts it. Recipe
   is not a published or verified image. Base is now pinned to the observed Pi2026.10.31a amd64 manifest digest. Pi is explicitly upgraded to1.5.0 to match the local proof.
3. Configure registered source file allowlist, trusted backend authority store,
   private worker and independent cleanup watchdog. Backend authority must match
   the user's exact cost/lifecycle grant, current restrictions and deadline; a
   task, DB claim, template prefix or feature flag does not authorize spending.
4. Obtain new host/model budget + lifecycle approval for the first actual task.
   Existing pilot approval is exhausted. Test actual private sibling/credential/
   egress boundaries, exact export/delete/final ledger and phone result/approval
   on that single task before calling it usable.

An executable private service now wires the backend store/provisioner/authority; it is not running in production. Context/scheduler/general coordination features are
not part of this release. The task endpoint is for the signed-in Dock owner.
Tasks > Inbox now includes a defaultOFF owner submission/result panel with registered sources. It does not grant spending. No claim of full coordination or push.

## Caveats

- The image recipe preserves the upstream Agent37 entrypoint but has not
  been built against that image. Its non-root environment must retain instance-
  scoped managed-model config and no workspace-management key. Settings/policy
  contain no secrets. T3Connect linking on the new image still needs a notified
  owner sign-in when authorized; the local proof does not pretend phone linking.
- Strict Supervised mode is verified before launch. Policy output is authenticated
  instance evidence, not attestation against a replaced binary. Root/same-user
  process threats still need hard execution separation and pinned image review.
- SQL persistence protects owner binding and lost-response states; it does not
  operate a watchdog. The operational worker must sweep due tasks independently.
- Account billing: DELETE ends disk/compute per vendor contract; stop/sleep does
  not. $5 wallet funding never established an all-in liability ceiling.

Sources inspected for transport and policy:
https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/thread.ts
https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/policy.ts
https://github.com/pingdotgg/t3code/blob/main/docs/user/managed-policy.md
https://www.agent37.com/docs/agents-api/instances/create.md
https://www.agent37.com/docs/agents-api/instances/delete.md
https://www.agent37.com/docs/agents-api/concepts

- A create timeout with no returned or recovered instance ID cannot be declared
  deleted just because one inventory read is empty: a late create may still land.
  The adapter keeps that state unresolved for watchdog/manual reconciliation.
  No blind create retry and no claim of a final cost until deletion is verified.

## Concrete service and owner client

`cd node/dock-node && npm ci && npm run t3 -- --once` runs one private service
sweep, but refuses before any API calls unless DOCK_T3_SERVICE=on. A long-lived
worker omits --once; a separately supervised watchdog uses --cleanup-only. Both
must be deployed outside request/serverless lifetimes. DOCK_T3_CONFIG must be a
private0600 JSON file. SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and AGENT37_API_KEY
are backend environment only. No secret is placed in that JSON or the phone.
Config has `template`, `sources` and `grants`; sources bind ownerId, workspaceId,
projectId, baseSha, local path and selected files. Grants are keyed by exact task
ID and contain taskId, ownerId, projectId, baseSha, userApprovalRef, expiresAt,
cleanupDeadline, maxModelCreditMicros, maxComputeCostMicros, lifecycleApproved
and watchdogReady. Ops derives these values from the owner's actual approval;
config alone cannot create permission. Grant file is reread before each claim/
create and model-budget choice, so removal takes effect without restart. Compute
max is an admission limit to verify against pricing and lifecycle, not a vendor
hard cap. Do not activate without the independent watchdog and current price check.

DOCK_T3_SOURCES is a server-only registry subset (no paths) for owner project/base
selection in Tasks > Inbox. The panel never selects arbitrary owner IDs or bases.
It queues only, labels spend authority separately and renders saved output as
untrusted plain text, never HTML. Retry reuses its request ID after uncertain POST.
There is no browser-side create/management/model credential. Hidden whenOFF.

Local service integration now uses the real service tick, exact fictional
source/grant binding, real scratch Postgres and actual managed T3/Pi with a
fictional inference endpoint. UI preview uses the actual component and fictional
owner API responses at390px and1100px; it checks project/base POST binding and
horizontal overflow. These are local fixtures, not production or phone evidence.

## Local image build attempt

Resolved Pi2026.10.31a published index digest
sha256:b208c21985c1f070ef2365e3b9c4ed9a7dadaa3f84f13f11b1a20af41a04bec2
and amd64 manifest
sha256:02c19e95f5750f5123fa0fcb88c376adb4fed031e0a3c9e32202f1ee83d7e26a.
A real rootless BuildKit34.2 OCI worker pulled that base, but failed before the
first RUN extracting /etc/gshadow (UID0/GID42, invalid argument). This local
host has one-ID namespace mapping, no effective capabilities or newuidmap/
newgidmap/rootlesskit helpers. It cannot build this multi-owner base as configured.
A Linux Docker/BuildKit host with UID/GID mapping is the minimum external need.
Agent37 documents free cloud builds but they automatically publish a template,
so that path requires separate publication authority. No cloud build attempted.

Stock Pi grants node passwordless sudo in its published Dockerfile. This recipe
removes sudo and setuid/setgid binaries before trusting root ownership. It also
pins Pi1.5.0 explicitly. Until a real image build and non-root launch prove this,
root-owned files in the standard image do not demonstrate policy tamper resistance.

Additional observed sources:
https://github.com/agent37-platform/templates/blob/main/images/b2b/pi/Dockerfile
https://github.com/agent37-platform/templates/blob/main/images/b2b/pi/entrypoint.sh
https://api.github.com/repos/agent37-platform/templates/git/refs/tags/b2b-pi/2026.10.31a
https://www.agent37.com/docs/agents-api/templates.md

## Free private build completed2026-11-04

The user supplied a temporary API key through a secure form. Cloud build
`tb_9eae96aed16d6562afed` succeeded and exact template GET verified:

- Pin: `dock-t3-owner-20261104@1`
- Scope: `workspace`, revision1, default_port null
- Image digest: `sha256:631b62fdbfea247d76fc5a88f6a2ae9c727e392517850dc78ba98106aa4930ca`
- No instance created; inventory remained empty; build price$0 in official docs.
- Context only Dockerfile, policy/settings JSON and ignore patterns, no secret or
  user source. No build secrets, no public registry push, no collaborators.
- First build failed Debian's sudo removal guard; corrected with its explicit
  SUDO_FORCE_REMOVE=yes. Second build logs confirm sudo removal, Pi1.5.0 and
  T3v0.1.7, then image export/private registration. The build does not prove a
  launched non-root T3 runtime, phone link, isolation or end-to-end production.

This supersedes earlier statements that the recipe had never been built or a
private template was missing. Local Docker/BuildKit limitation remains accurate,
but no longer blocks image construction. Next activation is bounded paid runtime
verification of this exact pin, separate migration/deployment review, and phone
result/approval proof. No ongoing compute has been enabled.
