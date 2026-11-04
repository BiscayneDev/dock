// Isolation security: base-ref validation, the registered-repo allowlist, and
// worktree attestation (verifyTaskWorktree catches drift after creation).
// Run: node --experimental-strip-types --test test/isolation-security.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isValidBaseRef, createTaskWorktree, verifyTaskWorktree } from "../lib/isolation/worktree.ts"
import { listRegisteredRepos, registerRepo, assertRepoRegistered } from "../lib/isolation/registered-repos.ts"

const execFileAsync = promisify(execFile)
const git = (cwd, args) => execFileAsync("git", ["-C", cwd, ...args])

async function makeRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), "dock-isosec-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await git(dir, ["init", "-b", "main"])
  await git(dir, ["config", "user.email", "test@example.com"])
  await git(dir, ["config", "user.name", "Test"])
  await writeFile(join(dir, "README.md"), "hi\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "init"])
  return dir
}

test("base refs are strictly validated before reaching git", () => {
  for (const ok of ["HEAD", "main", "feature/x.y", "release-2026-11"]) {
    assert.equal(isValidBaseRef(ok), true, ok)
  }
  for (const bad of ["", "../etc/passwd", "-d", "--upload-pack=touch /tmp/x", "a..b", "a b", "a~1", "a^1", "@{1}", "a:b", "a?b", "a*b", "a[b", "a\\b", "main/", "x.lock"]) {
    assert.equal(isValidBaseRef(bad), false, JSON.stringify(bad))
  }
})

test("createTaskWorktree rejects an invalid base ref before running git", async (t) => {
  const repo = await makeRepo(t)
  await assert.rejects(
    () => createTaskWorktree({ repoPath: repo, taskRef: "task-sec1", baseRef: "--upload-pack=touch /tmp/pwn" }),
    /invalid base ref/,
  )
})

test("registered-repo allowlist: only registered real paths pass", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-reg-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "registered-repos.json")
  const repo = await makeRepo(t)

  assert.deepEqual(await listRegisteredRepos(file), [])
  await assert.rejects(() => assertRepoRegistered(repo, file), /not registered/)

  const resolved = await registerRepo(repo, file)
  assert.equal(await assertRepoRegistered(repo, file), resolved)
  // idempotent
  await registerRepo(repo, file)
  assert.deepEqual(await listRegisteredRepos(file), [resolved])

  // a symlink pointing at a registered repo resolves to the same real path
  const link = join(dir, "link-to-repo")
  await symlink(resolved, link)
  assert.equal(await assertRepoRegistered(link, file), resolved)

  // a sibling directory that is not registered stays refused
  const other = join(dir, "other")
  await mkdir(other)
  await assert.rejects(() => assertRepoRegistered(other, file), /not registered/)

  // registering a non-repo fails
  await assert.rejects(() => registerRepo(other, file), /not a git repository/)
})

test("verifyTaskWorktree attests a healthy worktree and flags branch drift", async (t) => {
  const repo = await makeRepo(t)
  const wt = await createTaskWorktree({ repoPath: repo, taskRef: "task-verify1" })

  const healthy = await verifyTaskWorktree({ repoPath: repo, taskRef: "task-verify1" })
  assert.equal(healthy.ok, true, healthy.problems.join("; "))
  assert.equal(healthy.headBranch, wt.branch)

  // an agent switching branches inside its worktree is detected
  await git(wt.path, ["checkout", "-b", "dock/task-something-else"])
  const drifted = await verifyTaskWorktree({ repoPath: repo, taskRef: "task-verify1" })
  assert.equal(drifted.ok, false)
  assert.ok(drifted.problems.some((p) => p.includes("expected dock/task-task-verify1")), drifted.problems.join("; "))
})

test("verifyTaskWorktree flags a missing worktree", async (t) => {
  const repo = await makeRepo(t)
  const missing = await verifyTaskWorktree({ repoPath: repo, taskRef: "task-gone1" })
  assert.equal(missing.ok, false)
  assert.ok(missing.problems.some((p) => p.includes("missing")))
})
