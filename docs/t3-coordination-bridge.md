# Dock to T3 bridge: disabled local draft

T3 remains the phone and conversation front door. Dock supplies task identity,
curated shared source knowledge and review artifacts. This is not another mobile
shell. No production route, paid provider or provisioning transport imports this
module. The constructor defaults to disabled.

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
4. Launch writes durable intent before the T3 CLI. It supplies the brief and
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
T3 CLI host authentication itself has a full-access ceiling; the project default
must be set to Supervised before launch. The observed runtime mode is checked,
but that after-the-fact check cannot replace a verified startup configuration.
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

The CLI supports stdin, explicit provider/model, JSON launch IDs and JSON show.
It issues a short-lived local MCP session and revokes it after each command.
Remote MCP OAuth permissions apply to every project in an environment, not a
verified per-task security boundary. One private environment per workload is
still required for the owner's no-sibling-crossover requirement.

## Remaining activation work

- A reviewed private provisioner and deletion/billing watchdog, with durable
  authority evidence, lifecycle and budget choice. No continuing spend assumed.
- A production authenticated task router that constructs bindings server-side,
  scoped context delivery endpoint and revocation persistence. No route active.
- Stronger actual sibling attack tests, credential/network egress checks and
  private archive retention/recovery review.
- Real iPhone task/result, approval and notification checks. The user saying
  "Got it" during the pilot did not establish those.
- Broader curated Shipyard knowledge coverage and reviewed fact promotion.
  This bridge uses existing graph manifests; it does not claim a full scan.
- Existing merge and production-migration review stays in place.
