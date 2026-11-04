// Hard isolation must fail closed: a runtime that cannot confine an agent to a
// task worktree must not receive an isolated coding launch. These tests pin the
// contract: built-in runtimes declare they cannot enforce, and the cleanup path
// used by the activate guard actually removes the worktree and branch.
// Run: node --experimental-strip-types --test test/isolation-fail-closed.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)
const git = (cwd, args) => run("git", ["-C", cwd, ...args])

const { createTaskWorktree, removeTaskWorktree, worktreePathFor } = await import("../lib/isolation/worktree.ts")
import { readFile } from "node:fs/promises"

const { StubRuntime } = await import("../lib/runtimes/stub.ts")

test("built-in runtimes declare they cannot enforce worktree isolation", async () => {
  // Stub is importable under node strip-types; openclaw/ollama pull in
  // extensionless Next-only imports, so their declaration is pinned at source.
  assert.equal(new StubRuntime().enforcesWorktreeIsolation, false)
  for (const name of ["openclaw", "ollama"]) {
    const src = await readFile(new URL(`../lib/runtimes/${name}.ts`, import.meta.url), "utf8")
    assert.ok(src.includes("enforcesWorktreeIsolation = false"),
      `${name} must not claim enforcement it does not have; claiming it enables unconfined launches`)
  }
})

test("fail-closed cleanup removes the worktree and task branch", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-failclosed-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "repo")
  await run("git", ["init", "-q", repo])
  await git(repo, ["config", "user.email", "test@example.com"])
  await git(repo, ["config", "user.name", "Test"])
  await git(repo, ["commit", "-q", "--allow-empty", "-m", "init"])

  const wt = await createTaskWorktree({ repoPath: repo, taskRef: "task-x1" })
  const listed = await git(repo, ["worktree", "list", "--porcelain"])
  assert.ok(listed.stdout.includes(wt.path), "worktree exists before cleanup")

  await removeTaskWorktree({ repoPath: repo, taskRef: "task-x1", deleteBranch: true })
  const after = await git(repo, ["worktree", "list", "--porcelain"])
  assert.ok(!after.stdout.includes(worktreePathFor(repo, "task-x1")), "worktree removed")
  await assert.rejects(() => git(repo, ["rev-parse", "--verify", "dock/task-task-x1"]), "task branch deleted")
})
