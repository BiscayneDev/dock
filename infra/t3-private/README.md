# Private T3 image preparation

Private workspace image built and registered successfully by Agent37 on2026-11-04.
Pin: dock-t3-owner-20261104@1
Digest: sha256:631b62fdbfea247d76fc5a88f6a2ae9c727e392517850dc78ba98106aa4930ca
Build: tb_9eae96aed16d6562afed (free). Revision1 failed its authorized live runtime test on2026-11-04: installer directory mode0700 became root-only0500 after write removal, so node could not launch T3. Instance dt8wesvfnl was deleted after about2.5minutes, compute$0.00033, no model call. The corrected recipe passed an actual Docker image build and nonroot startup in free CI; it is NOT registered as an updated Agent37 template. See the verification section below. The Dockerfile pins the
observed published Pi2026.10.31a amd64 manifest, upgrades Pi to1.5.0 and installs
T3.0.1.7 (its installer verifies release checksums). Registry reads were public.

Build on a Linux Docker/BuildKit host with normal root or subordinate UID/GID
mapping:

    docker build --platform linux/amd64 -t dock-t3-private:review .

Do not create an instance from this command without new cost/lifecycle approval. Inspect the actual image first:
node must be non-root and cannot sudo, change ownership, write /etc/t3code,
/opt/dock-t3-runtime or the pinned Pi install, or gain root through setuid/caps.
Verify the preserved upstream entrypoint starts with an instance-scoped fictional
managed token, and that T3 loads the installed ceiling BEFORE a fictional turn.
Also test bootstrap's private repo/worktree, exact result and child processes.

No secrets should enter this five-file context. Agent37 cloud build uses plain
.dockerignore patterns and ignores negations, so this context uses no negations.
Cloud builds are documented free, but success publishes a workspace template.
A free private publication was completed within setup scope. Instance compute/model
usage is a separate paid action with new authority required.

Concrete local attempt used BuildKit34.2 rootless OCI worker/native snapshots:
base pulled, then extraction failed on /etc/gshadow UID0/GID42 due to one-ID
mapping. No newuidmap/newgidmap helpers or effective capabilities were available.
It did not execute RUN, produce an image or create a sandbox. Do not call that
attempt a built/tested image.

Permission regression: copy installer runtime, normalize `a+rX,a-w` (no write grant), then run `smoke.py` as final USER node during the build: start the actual T3 server, wait for its environment endpoint, verify the running server loaded approval-required policy, and shut down without a model call. Existing revision1 must not be used as a working runtime.


## Corrected image verification, 2026-11-04

CI run155 at head `c48592d7b442b07b5bf22e886d3f271c8bdd0f7d` built this exact pinned-base recipe without cache on a standard free Linux runner. The final `USER node` build step and a separate `docker run` both started T3v0.1.7, waited for its environment endpoint, and confirmed the running server loaded the approval-required policy. Both printed `NONROOT_STARTUP_MANAGED_POLICY_OK`. Root ownership, denied write access and no sudo checks passed. No model calls or account credentials were used.

Proof: https://github.com/BiscayneDev/dock/actions/runs/41939828116/job/126957479171

The image remained ephemeral. Nothing was pushed to a registry, uploaded as an artifact or published as a cache. Agent37 template revision1 is unchanged and known broken. An updated private registration, Agent37 runtime verification, phone connection and owner-task result remain unverified. No paid instance, migration, merge or production deployment followed this CI run.
