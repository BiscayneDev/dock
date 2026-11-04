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
   is not a published or verified image. Supply the required verified base image digest before build; the recipe deliberately has no guessed default base tag.
3. Configure registered source file allowlist, trusted backend authority store,
   private worker and independent cleanup watchdog. Backend authority must match
   the user's exact cost/lifecycle grant, current restrictions and deadline; a
   task, DB claim, template prefix or feature flag does not authorize spending.
4. Obtain new host/model budget + lifecycle approval for the first actual task.
   Existing pilot approval is exhausted. Test actual private sibling/credential/
   egress boundaries, exact export/delete/final ledger and phone result/approval
   on that single task before calling it usable.

The worker is a library with injected backend store/provisioner/authority, not a
running production service. Context/scheduler/general coordination features are
not part of this release. The task endpoint is for the signed-in Dock owner;
a small existing-client submission affordance is still needed for normal daily
use rather than a direct API submission. No claim of full coordination or push.

## Caveats

- The sample image recipe preserves the upstream Agent37 entrypoint but has not
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
