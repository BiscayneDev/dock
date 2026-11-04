// argv shape for the confined coding agent: git works, shared state read-only,
// no network, key never in env. Run: node --test node/dock-node/test/isolated-agent-argv.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { containerIsolatedAgentArgs } from "../src/isolation.mjs"

const REPO = "/home/demo/projects/myrepo"
const WT = "/home/demo/projects/.dock-worktrees/myrepo/task-7"
const MAIN_GIT = "/home/demo/projects/myrepo/.git"
const WT_GIT = `${MAIN_GIT}/worktrees/task-7`
const SCRATCH = join(tmpdir(), "dock-isolated-test123")

function args(over = {}) {
  return containerIsolatedAgentArgs({
    runtime: "docker", repoPath: REPO, worktreePath: WT, worktreeGitDir: WT_GIT,
    mainGitDir: MAIN_GIT, scratchDir: SCRATCH, socketPath: join(SCRATCH, "infer.sock"),
    hasPackedRefs: true, ...over,
  }).join(" ")
}

test("agent argv: all mounts at host paths, shared state read-only, no network", () => {
  const j = args()
  assert.ok(j.includes("--network none"), j)
  assert.ok(j.includes(`-v ${WT}:${WT}`), j)
  assert.ok(j.includes(`-v ${WT_GIT}:${WT_GIT}`), j)
  assert.ok(j.includes(`-v ${MAIN_GIT}/objects:${MAIN_GIT}/objects:ro`), j)
  assert.ok(j.includes(`-v ${SCRATCH}/refs:${MAIN_GIT}/refs`), j)
  assert.ok(j.includes(`-v ${MAIN_GIT}/packed-refs:${MAIN_GIT}/packed-refs:ro`), j)
  assert.ok(j.includes(`-v ${MAIN_GIT}/HEAD:${MAIN_GIT}/HEAD:ro`), j)
  assert.ok(j.includes(`-v ${SCRATCH}/config:${MAIN_GIT}/config:ro`), j)
  assert.ok(j.includes(`-v ${SCRATCH}/objects:${SCRATCH}/objects`), j)
  assert.ok(j.includes(`-v ${join(SCRATCH, "infer.sock")}:/run/dock-infer.sock`), j)
  assert.ok(j.includes("--read-only") && j.includes("--cap-drop ALL"), j)
  assert.ok(j.endsWith(`node:22-bookworm node ${WT}/.dock/agent.mjs`), j)
  assert.ok(!j.includes("hooks"), "hooks never mounted")
})

test("agent argv refuses path mismatches", () => {
  assert.throws(() => args({ worktreeGitDir: "/somewhere/else" }), /worktree gitdir/)
  assert.throws(() => args({ mainGitDir: "/other/.git" }), /registered repo/)
  assert.throws(() => args({ scratchDir: "/var/tmp/evil" }), /tmpdir/)
  assert.throws(() => args({ scratchDir: join(tmpdir(), "random") }), /dock-isolated/)
  assert.throws(() => args({ socketPath: "/tmp/other.sock" }), /infer\.sock/)
  assert.throws(() => args({ runtime: "runc" }), /unknown container runtime/)
  assert.throws(() => args({ worktreePath: "/etc" }), /non-task-worktree/)
})
