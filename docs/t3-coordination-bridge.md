# Dock to T3 bridge: disabled local draft

T3 remains the phone and conversation front door. Dock supplies task identity,
curated shared source knowledge and review artifacts. This is not another mobile
shell. No paid provider, active production router or provisioning transport imports
this module. A separate owner-only preparation endpoint is default-OFF. The constructor defaults to disabled.

## Implemented path

1. A trusted host reserves an owner/workspace/project/task/private-execution
   tuple, resolved base commit and cleanup deadline in a private durable registry.
   Instance reuse across sibling tasks is refused, even across registry restarts.
2. A read-only capability is bound to that exact tuple, expires in at most fifteen
   minutes and can be revoked. It cannot start a thread, spend, delete an instance
   or promote memory. The context service consumes this permission before reads.
3. The source service selects only explicitly allowed graph-manifest sources.
   It reads committed Git bytes at the recorded SHA and verifies their SHA256,
   then provides bounded line excerpts. Dirty worktrees, sibling task output,
   earlier private histories and credentials are not searched. Labels are leads,
   not authority to broaden the source allowlist. Source data is untrusted.
4. Before launch, the bound execution runs `t3 policy show`. The bridge refuses
   no/unknown policy, a broader ceiling, or an installed policy not acknowledged
   by the running server. It requires an active `approval-required` ceiling.
   Launch writes durable intent before the T3 CLI. It supplies the brief and
   actual source excerpts on stdin to `thread start <private-worktree> -`.
   No `--wait`: thread and run IDs are saved before observing completion.
   An uncertain launch is never silently repeated. Crash-left locks fail closed
   and require host reconciliation, not automatic lock stealing.
5. Observation uses the saved execution, base directory, thread and exact run.
   A later phone turn cannot substitute its response. Result text is privately
   archived with a hash, marked untrusted and review-required. It is never
   promoted to shared memory, imported into host Git, merged or deployed.
6. Cleanup discovery and orchestration retain responsibility on unknown state.
   Deletion is verified by an owning read, including after a lost response.
   No vendor delete adapter or automatic watchdog is active in this draft.

## What the boundary does and does not prove

The filesystem registry is local-host durability only. It is NOT a Vercel or
multi-worker production store. It must be replaced by transactional persistent
storage before production routing.

The registry, launch CAS, exact-result correlation, capability checks and source
hash validation are implemented mechanisms with tests. File locks are for a
single trusted host filesystem, not a distributed database. Private directory
permissions do not protect against another process running as the same OS user.

The injected transport MUST run inside one already isolated private execution.
`hostBinding` is a trusted provisioner seam, not remote attestation or a sandbox.
Passing `kind: private-instance` or `supervised: true` does not create isolation.
Neither field may come from a model or unauthenticated request payload. The
binding includes the resolved base SHA. The private repository plus linked
worktree must be created and verified by the provisioner before launch.

`local-cli.mjs` deliberately says it is not a host sandbox. It starts no cloud
resource and passes only PATH, HOME and telemetry-off, not the host's full env.
Use it only inside the provisioned namespace, or with fictional local fixtures.
T3 CLI host authentication itself has a full-access ceiling, so the pre-launch
managed-policy check is mandatory. A Supervised settings default alone is refused.
The installed ceiling must be acknowledged by the running server. The provisioner
must pin provider launch configuration and control server restarts; a text check
is not attestation against a compromised/replaced T3 binary or runtime. The
observation mode check remains a separate defense.
T3 supervised approvals are not a substitute for OS/container separation.

A host watchdog still needs a supported scheduler, authority/budget enforcement,
private-instance provisioning and reconciliation on restart. A due row does not
stop billing. Wallet limits, retention and paid turns still require approval.
No tokens, workspace API keys, production account credentials or private graph
files are committed here. No network policy is invented: T3 Connect and managed
inference need their documented outbound routes, while sibling/control-plane
access must remain inaccessible.

## Actual source-backed fixture

Run with an already installed stable T3 and Pi binary directory:

```
node scripts/proof/t3-context-fixture.mjs <installed-bin-directory> <private-result.json>
```

The script uses real T3 0.1.7 CLI/server and Pi RPC, but only a fictional loopback
model endpoint. It makes a committed source, verified graph manifest and scoped
capability, then proves the committed-source canary and commit SHA reached the
model request. It records one request, a matching review-required result and
private archive correlation. It removes all temporary fixture data afterward.
The real unmanaged fixture server is refused by the default policy check before
launch. The source-consumption leg then injects explicitly fictional policy
evidence only; it is not a production managed-policy acceptance test.
This is not paid inference, a phone UI check, OS isolation proof or production
integration. The separate approved Agent37 pilot proved the paid transport path
and tunnel, not this complete bridge on a durable host.

## Source contracts reviewed

T3 source snapshot `9e85538535c8553901351112ab02dd1dd62db5ee` and stable
0.1.7 runtime both informed the CLI proof. Future upgrades need contract tests.

- https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md
- https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/thread.ts
- https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/orchestratorMcp.ts
- https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md
- https://github.com/pingdotgg/t3code/blob/main/docs/internals/environment-auth.md
- https://github.com/pingdotgg/t3code/blob/main/docs/user/managed-policy.md
- https://github.com/pingdotgg/t3code/blob/main/apps/server/src/cli/policy.ts

The CLI supports stdin, explicit provider/model, JSON launch IDs and JSON show.
It issues a short-lived local MCP session and revokes it after each command.
Remote MCP OAuth permissions apply to every project in an environment, not a
verified per-task security boundary. One private environment per workload is
still required for the owner's no-sibling-crossover requirement.

## Remaining activation work

- A reviewed private provisioner and deletion/billing watchdog, with durable
  authority evidence, lifecycle and budget choice. No continuing spend assumed.
- A production authenticated task router that constructs bindings server-side,
  scoped context delivery endpoint and revocation persistence. No route active; the later section describes the disabled preparation-only endpoint.
- Stronger actual sibling attack tests, credential/network egress checks and
  private archive retention/recovery review.
- Real iPhone task/result, approval and notification checks. The user saying
  "Got it" during the pilot did not establish those.
- Broader curated Shipyard knowledge coverage and reviewed fact promotion.
  This bridge uses existing graph manifests; it does not claim a full scan.
- Existing merge and production-migration review stays in place.

## Focused next production seam, grounded in current Dock

The next change should be a disabled Supabase-backed execution-binding repository
and narrow owner-session endpoint, not a blanket reuse of `/api/runs` auth.

Current source:
- `lib/assistant-store.ts:assistantContext` verifies session user with
  `currentUser`, then loads that user's workspace. `projectInWorkspace` can
  verify project membership before binding any task.
- `app/api/runs/route.ts:resolveContext` also accepts mobile and machine tokens.
  The machine-token path is a single-workspace superuser fallback, not a
  task-scoped private-execution credential. Do not pass `DOCK_AGENT_TOKEN` to
  an execution or use it as permission to create a binding.
- `lib/queue.ts` stores runs/events in Supabase, owner calls use session/RLS,
  worker calls use the service role. Run claims already have a lease owner
  and deadline. Device claim auth is implemented in `lib/devices.ts` and
  `app/api/devices/claim/route.ts`; it should not become workspace API access.
- `supabase/migrations/20261104_coding_call_reservations.sql` demonstrates the
  project's row-locking RPC pattern: lock task run, validate live lease,
  uniqueness and budget before a write, revoke PUBLIC execution and grant
  only the backend service role. Its reservation still does not prove an
  upstream hard cost ceiling.

Proposed reviewable slice, not applied here:
1. A persistent `execution_bindings` table keyed by owner/workspace/project/run,
   unique private execution ID, immutable base SHA, phase/version, exact T3
   thread/run, policy evidence, cleanup deadline and private artifact reference.
   Owner-read RLS only. Backend CAS functions lock the binding and validate its
   task-run lease; do not accept owner IDs from request JSON.
2. A disabled owner-session-only preparation endpoint uses `assistantContext`,
   verifies run ownership and project membership, and writes intent. It does not
   create an instance or launch a paid turn. A separate trusted provisioner later
   resolves binding and authority, checks policy, and records execution identity.
3. Persist hashed short-lived context capabilities with revocation and exact
   binding version. Authenticated context reads join the run/binding and fail
   after expiry, lease loss, deletion or scope mismatch. Keep source allowlists
   server-owned. A context capability never permits creating runs or spending.
4. Store exported artifacts in private storage with owner-read policy, content
   hash and size limits before marking review-ready. No service-role secret in
   the phone, source bundle or private execution.
5. A separately operated cleanup worker owns due bindings, deletion-state and
   ledger reconciliation even after process restarts. Vercel request handlers
   and local filesystem deadlines are not lifecycle supervision.

Acceptance before activation: two-owner/multi-workspace RLS tests, duplicate
launch/deletion timeout races, lease theft/revocation tests, lost-response
reconciliation, managed-policy preflight against an actual administrator-owned
policy, and retained export after execution deletion. The later section implements only the disabled preparation/claim portion. No
migration or endpoint is deployed or activated by this PR.

## Disabled persistent preparation slice added after the initial bridge

`POST /api/t3/preparations` is now present but returns501 unless
`DOCK_T3_PREPARATION=on`. It accepts only runId, resolved baseSha and cleanupDeadline
within thirty minutes. It uses owner-session `assistantContext` only, never
mobile-token or `DOCK_AGENT_TOKEN` fallback. The session-backed RPC independently
binds auth.uid to the run's workspace and project. No instance or task is launched.
The supplied SHA remains a preparation claim; the trusted provisioner must verify
it against the registered committed base before execution.

The draft migration `20261104_t3_execution_preparations.sql` creates durable
preparation identity, immutable task-payload snapshot, owner-read-only RLS and
backend-only atomic claim. Concurrent preparation replay returns the same row;
changed SHA/deadline refuses. Claim locks task then binding in consistent order,
checks owner/workspace/project/payload/status/deadline and refuses an existing
home-device lease. Unique execution IDs prevent reuse across sibling tasks.
Task lease and binding claim commit atomically. This claim records an already
approved private execution; it neither provisions nor proves paid authority.

Scratch PostgreSQL proof uses fictional two-owner data and real roles/RLS,
transactions, row locks and eight-way races. It checks one preparation row,
one claim winner, cross-owner/project refusal, owner-write/backend-claim privilege
boundaries, instance reuse rollback, lease theft refusal, changed payload,
expired deadline and prepare/claim lock order. This is not an actual Supabase
production test. No migration has been applied to a connected account.

This is deliberately not the entire persistent bridge: thread/run/artifact/CAS
transitions, persisted context capability revocation, lease recovery, separate
cleanup watchdog and live policy/provisioner verification remain open. Existing
home workers may claim a queued prepared task first; the T3 claim then refuses
rather than stealing it. A future reviewed router must select the intended
executor before enabling either path. The current bridge remains disabled.

Reproduce the additional check with `python3 scripts/e2e/prove-t3-preparations.py`.
The script creates a disposable local PostgreSQL server; it does not read app
credentials or connect to Supabase. The larger PR remains stacked on experimental
PR13 and cannot ship independently. Setting a feature flag alone does not complete
these activation prerequisites.
