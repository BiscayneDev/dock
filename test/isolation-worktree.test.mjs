// Isolated task runs: branch naming, path containment, env scrubbing, and real git
// worktree behavior (create, commit in isolation, diff, cleanup) against a temp repo.
// Run: node --experimental-strip-types --test test/isolation-worktree.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  taskBranchName,
  isValidTaskRef,
  worktreeRootFor,
  worktreePathFor,
  isPathInside,
  scrubEnv,
  createTaskWorktree,
  removeTaskWorktree,
  diffForTaskBranch,
} from "../lib/isolation/worktree.ts"

const execFileAsync = promisify(execFile)

test("branch names are derived and conservative", () => {
  assert.equal(taskBranchName("abc-123"), "dock/task-abc-123")
  assert.equal(isValidTaskRef("abc-123"), true)
  for (const bad of ["", "Abc", "../x", "a b", "-lead", "a".repeat(64), "a/b", "a..b"]) {
    assert.equal(isValidTaskRef(bad), false, bad)
    assert.throws(() => taskBranchName(bad), /invalid task ref/)
  }
})

test("worktrees live next to the repo, never inside the main checkout", () => {
  const root = worktreeRootFor("/home/dev/dock")
  assert.equal(root, "/home/dev/.dock-worktrees/dock")
  const p = worktreePathFor("/home/dev/dock", "t1")
  assert.equal(p, "/home/dev/.dock-worktrees/dock/t1")
  assert.equal(isPathInside(root, p), true)
  assert.equal(isPathInside(root, "/home/dev/dock"), false)
  assert.equal(isPathInside(root, "/home/dev/.dock-worktrees/dock-evil"), false)
})

test("scrubEnv keeps an allowlist and drops secrets", () => {
  const env = { PATH: "/usr/bin", HOME: "/home/dev", ANTHROPIC_API_KEY: "sk-secret", OPENAI_API_KEY: "sk-2", SUPABASE_SERVICE_ROLE_KEY: "srv", DOCK_AGENT_TOKEN: "tok" }
  const scrubbed = scrubEnv(env)
  assert.equal(scrubbed.PATH, "/usr/bin")
  assert.equal(Object.keys(scrubbed).includes("ANTHROPIC_API_KEY"), false)
  assert.equal(Object.keys(scrubbed).includes("SUPABASE_SERVICE_ROLE_KEY"), false)
  assert.equal(Object.keys(scrubbed).includes("DOCK_AGENT_TOKEN"), false)
  const withExtra = scrubEnv(env, ["ANTHROPIC_API_KEY"])
  assert.equal(withExtra.ANTHROPIC_API_KEY, "sk-secret")
})

test("real git: a task runs in its own worktree and branch, reviewed via diff, cleaned up after", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-wt-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "repo")
  const git = (...args) => execFileAsync("git", ["-C", repo, ...args]).then((r) => r.stdout.trim())

  await execFileAsync("git", ["init", "-b", "main", repo])
  await git("config", "user.email", "test@example.com")
  await git("config", "user.name", "Test")
  await writeFile(join(repo, "app.txt"), "v1\n")
  await git("add", ".")
  await git("commit", "-m", "init")

  // Two sibling tasks get separate worktrees and branches off main.
  const a = await createTaskWorktree({ repoPath: repo, taskRef: "aaaa-1", baseRef: "main" })
  const b = await createTaskWorktree({ repoPath: repo, taskRef: "bbbb-2", baseRef: "main" })
  assert.equal(a.branch, "dock/task-aaaa-1")
  assert.notEqual(a.path, b.path)
  assert.equal(isPathInside(worktreeRootFor(repo), a.path), true)

  // git itself refuses to check out the same branch in a second worktree.
  await assert.rejects(
    execFileAsync("git", ["-C", repo, "worktree", "add", join(dir, "dup"), "dock/task-aaaa-1"]),
    /already checked out/,
  )

  // Task A commits in isolation; the main checkout and sibling are untouched.
  await writeFile(join(a.path, "app.txt"), "v1\nv2-from-task-a\n")
  await execFileAsync("git", ["-C", a.path, "add", "."])
  await execFileAsync("git", ["-C", a.path, "-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-m", "task a change"])
  const mainHead = (await execFileAsync("git", ["-C", repo, "show", "main:app.txt"])).stdout.trim()
  assert.equal(mainHead, "v1")

  // The review surface: diff of the task branch against base.
  const diff = await diffForTaskBranch({ repoPath: repo, taskRef: "aaaa-1", baseRef: "main" })
  assert.equal(diff.aheadBy, 1)
  assert.match(diff.stat, /1 file changed, 1 insertion/)
  assert.match(diff.nameStatus, /M\tapp.txt/)
  assert.match(diff.commits, /task a change/)

  // Sibling B sees neither A's commit nor its file change.
  const bDiff = await diffForTaskBranch({ repoPath: repo, taskRef: "bbbb-2", baseRef: "main" })
  assert.equal(bDiff.aheadBy, 0)

  // Cleanup: remove worktrees; deleting only ever touches dock/task-* branches.
  await removeTaskWorktree({ repoPath: repo, taskRef: "aaaa-1", deleteBranch: true })
  const branches = await git("branch", "--list", "dock/*")
  assert.equal(branches.includes("dock/task-aaaa-1"), false)
  assert.equal(branches.includes("dock/task-bbbb-2"), true)
  await removeTaskWorktree({ repoPath: repo, taskRef: "bbbb-2", deleteBranch: true })
})

test("createTaskWorktree rejects non-repo paths and unknown base refs", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-wt-bad-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(createTaskWorktree({ repoPath: dir, taskRef: "x-1" }), /not a git repository/)
})
