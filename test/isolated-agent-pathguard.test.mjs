// Unit tests for the agent tool layer's path confinement (second boundary;
// bubblewrap mounts are the first). Run with the suite.
import { test } from "node:test"
import assert from "node:assert/strict"

process.env.DOCK_WORKTREE_PATH = "/wt"
process.env.SHIPYARD_INFERENCE_URL = "http://127.0.0.1:9"
const { resolveInsideWorktree } = await import("../scripts/isolated-coding-agent.mjs")

test("path guard: relative paths stay inside", () => {
  assert.equal(resolveInsideWorktree("src/a.ts"), "/wt/src/a.ts")
  assert.equal(resolveInsideWorktree("./x/../b.txt"), "/wt/b.txt")
  assert.equal(resolveInsideWorktree("."), "/wt")
})

test("path guard: traversal and absolute escapes rejected", () => {
  for (const p of ["../escape.txt", "../../etc/passwd", "/etc/hostname", "/wt-sibling/secret", "/tmp/x"]) {
    assert.throws(() => resolveInsideWorktree(p), /path escapes worktree/, p)
  }
})
