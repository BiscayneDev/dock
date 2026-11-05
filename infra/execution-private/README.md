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
Pi wrapper starts a loopback bridge to `/run/dock/model.sock`; it holds no
provider/controller key and uses a private temporary Pi config. The controller
owns the other end, fixes execution identity and consumes bounded quote + settle
before releasing text/tool calls. Local real Pi compatibility passes, including
SSE after settlement. This is not an activated upstream max-price guarantee.

Build context must be repository root, with
`docker build -f infra/execution-private/Dockerfile .`.
The image is inert without a private controller socket mounted into a separately
network-isolated task namespace. No broad host socket or shared task mount is
allowed. The candidate does not install that controller or claim Agent37 supports
this private mount/network design. Remote Unix fixture tests did not qualify an
external Shipyard connection. Preserve Jev and the existing eligible model pool.
No caller/model may turn these files into execution or spending authority.

Public sources:
- https://www.agent37.com/docs/agents-api/templates.md
- https://www.agent37.com/docs/agents-api/instance-network.md
- https://www.agent37.com/docs/agents-api/exec.md

Beacon now uses a second fixed private mount `/run/dock/memory.sock`. The wrapper
registers only Dock's search/private-note/distill MCP in its fresh Pi state;
`--no-mcp` was removed from the locked launch policy. The controller binds the
memory client to a single capability and refuses identity/destination overrides
and promotion. Candidate workload needs no execution bearer, provider key or
controller key. A real local Pi tool turn through both sockets, actual Next and
Postgres persists one private note and settles two model calls. This does not
prove the candidate image was built or remote mounts are available.
