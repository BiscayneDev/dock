# Private T3 image preparation

No image has been successfully built or published. The Dockerfile pins the
observed published Pi2026.10.31a amd64 manifest, upgrades Pi to1.5.0 and installs
T3.0.1.7 (its installer verifies release checksums). Registry reads were public.

Build on a Linux Docker/BuildKit host with normal root or subordinate UID/GID
mapping:

    docker build --platform linux/amd64 -t dock-t3-private:review .

Do not publish/register/create from this command. Inspect the actual image first:
node must be non-root and cannot sudo, change ownership, write /etc/t3code,
/opt/dock-t3-runtime or the pinned Pi install, or gain root through setuid/caps.
Verify the preserved upstream entrypoint starts with an instance-scoped fictional
managed token, and that T3 loads the installed ceiling BEFORE a fictional turn.
Also test bootstrap's private repo/worktree, exact result and child processes.

No secrets should enter this four-file context. Agent37 cloud build uses plain
.dockerignore patterns and ignores negations, so this context uses no negations.
Cloud builds are documented free, but success publishes a workspace template.
That publication is outside the present draft-only scope. Instance compute/model
usage is a separate paid action with new authority required.

Concrete local attempt used BuildKit34.2 rootless OCI worker/native snapshots:
base pulled, then extraction failed on /etc/gshadow UID0/GID42 due to one-ID
mapping. No newuidmap/newgidmap helpers or effective capabilities were available.
It did not execute RUN, produce an image or create a sandbox. Do not call that
attempt a built/tested image.
