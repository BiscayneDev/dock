# Experimental isolated coding

Disabled by default. No production enablement or merge is implied.

The Vercel app is the control plane, not the execution host. Experimental home
runs can carry `isolatedTask: {repoKey, taskRef, baseRef, brief}`. The home node
resolves repoKey against its local registered repositories. No remote path is
accepted as a mount destination.

Each task receives a private Git repository initialized from only the selected
base snapshot, with its own linked worktree and branch. Shared history, sibling
objects, credentials, hooks and configuration are not copied or mounted. The
agent can commit inside this private repository. No agent-written status,
objects or metadata are imported into the owner's repository, and no owner ref
is advanced. Results remain local review artifacts.

Linux bubblewrap is exercised with real child processes in the test suite.
Docker/Podman arguments are implemented but not executed in this environment.
The container image must already exist (`--pull=never`); no image pull is started.
Apple Containerization is not supported by this path because host Unix-socket
sharing has not been verified. No enforcement claim applies to that host.

The sandbox has no network. Its only inference route is a host-held Unix socket
that calls Dock's authenticated device client. The device token and gateway
credentials never enter the sandbox.

## Remaining blocker

The production `/api/devices/infer` route returns 501 for coding/tool-call
requests. A budget-reserved, protocol-validated coding inference adapter is still
required. The current one-shot text path is not a safe substitute. The
fictional HTTP integration test verifies the device client, executor, real
sandbox, tool calls and completion callback against a fixture server, not the
production Next route or real inference. It incurs no real inference spend.

The experiment remains off. Tests do not authorize enabling it or merging it.
