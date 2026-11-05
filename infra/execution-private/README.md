# Private execution image candidate

Source-only recipe. Not built, published, deployed or qualified by its existence.
No retained phone configuration is included or changed.

The existing workspace template `dock-t3-owner-20261104@1` resolves to image
`sha256:631b62fdbfea247d76fc5a88f6a2ae9c727e392517850dc78ba98106aa4930ca`.
Two authorized temporary instances reproduced its startup failure: runtime root
mode0500 prevented the nonroot user from executing T3. The fixed owner-admin
`repair.py` was tested on those two disposable IDs only, then both passed
nonroot T3v0.1.7 startup and running managed-policy verification. Their cleanup
is separately owned and the working phone instance is excluded.

This Dockerfile incorporates that exact ownership/permission repair at build
and runs `smoke.py` as final nonroot user. The smoke test starts real T3,
checks its running policy and recursively checks root ownership/nonwritability.
It makes no model request. A future successful immutable build still requires
its own digest/revision inspection and remote qualification before activation.
Do not reuse the old revision1 attestation as proof of this candidate.

The candidate now names `dockrelay/auto`, not the managed default. The fixed
Pi wrapper creates task-local model/memory Unix sockets and a loopback bridge
with a fresh random local token. It enqueues canonical requests in the private
execution spool. The controller reads/replies using Agent37's documented exec
control plane, which remains available under networkdenyall. This removes the
unsupported assumption that an external controller socket can be mounted into
a remote instance. No provider, controller or execution capability enters the
workload; the local token grants no external account access.

Controller verifies actual host/execution metadata, binds the private capability
to that execution, and claims request identity in its own durable Postgres ledger
before dispatch. Task spool files are untrusted data, not authority. Unknown
claims/requests never redispatch. Quote/settlement and Beacon scope checks use
existing real controller endpoint functions. The80000byte mailbox input bound
fits exec's512KB stdout cap even after JSON escaping; replies are capped200KB.
Truncation/timeouts are unconfirmed, never free usage or implicit retry.

Build context must be repository root, with
`docker build -f infra/execution-private/Dockerfile .`.
The image remains unbuilt/unqualified. Supported control-plane semantics do not
prove remote spool permissions, latency, running policy or billed model bounds.
Loopback is not a public listener; host networking still needs independent
verification because template preview ports can otherwise be routed. The random
local token is an additional guard, not a replacement for networkdenyall or
private task roots. Preserve Jev and the eligible model pool. No spending or
execution authority is created by this source.

Public sources:
- https://www.agent37.com/docs/agents-api/templates.md
- https://www.agent37.com/docs/agents-api/instance-network.md
- https://www.agent37.com/docs/agents-api/exec.md
