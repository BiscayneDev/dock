// The isolated runtime REALLY confines: two sibling tasks in one repo run in
// bubblewrap sandboxes whose only writable host directory is their own
// worktree. Verified adversarially: relative/absolute escapes, symlink
// escapes (tool layer + dangling mounts), sibling worktree reads, shared-git
// tamper (refs/config/hooks/objects), network egress (no net namespace; a
// canary server proves zero connections), and gateway-secret exposure (the
// key is relayed host-side; the agent env never carries it).
// Skips when bubblewrap is absent (the runtime fails closed there too).
// Run: node --experimental-strip-types --test test/isolated-runtime.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile, access, symlink, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"
import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"

const run = promisify(execFile)
const git = (cwd, args) => run("git", ["-C", cwd, ...args])
const BWRAP = ["/usr/bin/bwrap", "/bin/bwrap"].find((p) => existsSync(p))

const { createTaskWorktree } = await import("../lib/isolation/worktree.ts")
const { IsolatedRuntime } = await import("../lib/runtimes/isolated.ts")

const calls = []
function scriptFor(marker) {
  const other = marker === "TASK_A" ? "hello-b.txt" : "hello-a.txt"
  const own = marker === "TASK_A" ? "hello-a.txt" : "hello-b.txt"
  const steps = [
    { name: "write_file", args: { path: own, content: `done by ${marker}\n` } },
    // lexical escapes
    { name: "write_file", args: { path: "../escape.txt", content: "escape\n" } },
    { name: "write_file", args: { path: "/tmp/escape-abs.txt", content: "escape\n" } },
    { name: "read_file", args: { path: `../${other}` } },
    // symlink escapes (fixtures planted in each worktree: etc-link -> /etc,
    // sib-link -> sibling worktree)
    { name: "read_file", args: { path: "etc-link/hostname" } },
    { name: "read_file", args: { path: `sib-link/${other}` } },
    { name: "write_file", args: { path: "etc-link/pwn.txt", content: "pwn\n" } },
    // symlink escape through the shell boundary (allowed verb, dangling target)
    { name: "run_shell", args: { command: "cat etc-link/hostname" } },
    // network egress attempt through an allowlisted command (fixture
    // package.json test script fetches a canary URL)
    { name: "run_shell", args: { command: "npm test" } },
    { name: "run_shell", args: { command: `git add ${own}` } },
    { name: "run_shell", args: { command: `git commit -m ${marker}` } },
    { name: "finish", args: { summary: `${marker} complete` } },
  ]
  return steps
}

test("isolated runtime: sibling confinement end to end", { skip: !BWRAP, timeout: 180000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-isolated-test-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "repo")
  await run("git", ["init", "-q", repo])
  await git(repo, ["config", "user.email", "test@example.com"])
  await git(repo, ["config", "user.name", "Test"])

  // Canary: any network connection from inside a sandbox counts as a failure.
  let canaryHits = 0
  const canary = http.createServer((req, res) => { canaryHits++; res.end("x") })
  await new Promise((r) => canary.listen(0, "127.0.0.1", r))
  t.after(() => canary.close())
  const canaryPort = canary.address().port

  await writeFile(join(repo, "README.md"), "fixture repo\n")
  await writeFile(join(repo, "package.json"), JSON.stringify({
    name: "fixture", scripts: { test: `node -e "fetch('http://127.0.0.1:${canaryPort}/').then(()=>console.log('NETOK')).catch(()=>console.log('NETFAIL'))"` },
  }))
  await git(repo, ["add", "-A"])
  await git(repo, ["commit", "-q", "-m", "init"])

  // Mock OpenAI-compatible inference; asserts the host-side relay adds the key.
  const authSeen = []
  const steps = { TASK_A: 0, TASK_B: 0 }
  const infer = http.createServer((req, res) => {
    authSeen.push(req.headers.authorization ?? null)
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const parsed = JSON.parse(body)
      const brief = parsed.messages.find((m) => m.role === "user")?.content ?? ""
      const marker = brief.includes("TASK_A") ? "TASK_A" : "TASK_B"
      const script = scriptFor(marker)
      const step = steps[marker]++
      const call = script[Math.min(step, script.length - 1)]
      calls.push({ marker, name: call.name })
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [
          { id: `call_${marker}_${step}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } },
        ] } }],
      }))
    })
  })
  await new Promise((r) => infer.listen(0, "127.0.0.1", r))
  t.after(() => infer.close())

  const wtA = await createTaskWorktree({ repoPath: repo, taskRef: "task-a" })
  const wtB = await createTaskWorktree({ repoPath: repo, taskRef: "task-b" })

  // Plant symlink fixtures (filesystem-level, equivalent to a malicious repo).
  await symlink("/etc", join(wtA.path, "etc-link"))
  await symlink(wtB.path, join(wtA.path, "sib-link"))
  await symlink("/etc", join(wtB.path, "etc-link"))
  await symlink(wtA.path, join(wtB.path, "sib-link"))

  // Host-side baseline: refs, config, hooks must be identical after the runs.
  const mainRefBefore = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim()
  const branchBRefBefore = (await git(repo, ["rev-parse", "refs/heads/dock/task-task-b"])).stdout.trim()
  const configHashBefore = createHash("sha256").update(readFileSync(join(repo, ".git", "config"))).digest("hex")
  const hooksBefore = await readdir(join(repo, ".git", "hooks")).catch(() => [])

  delete process.env.DOCK_ISOLATED_RUNTIME
  const rtOff = new IsolatedRuntime()
  assert.equal(rtOff.enforcesWorktreeIsolation, false, "experimental gate: off by default")
  await assert.rejects(rtOff.activate({ taskId: "x", title: "x", description: "", assignee: "b", priority: "medium", callbackUrl: "http://x", message: "x", worktree: { path: wtA.path, branch: wtA.branch, baseRef: wtA.baseRef } }), /experimental and disabled/)
  process.env.DOCK_ISOLATED_RUNTIME = "on"
  const rt = new IsolatedRuntime()
  assert.equal(rt.enforcesWorktreeIsolation, true, "bwrap present + gate on: runtime must claim enforcement")

  process.env.SHIPYARD_INFERENCE_URL = `http://127.0.0.1:${infer.address().port}`
  process.env.SHIPYARD_INFERENCE_API_KEY = "fictional-key"
  await rt.activate({ taskId: "task-a", title: "A", description: "", assignee: "builder", priority: "medium", callbackUrl: "http://127.0.0.1:9", message: "Do TASK_A.", worktree: { path: wtA.path, branch: wtA.branch, baseRef: wtA.baseRef } })
  await rt.activate({ taskId: "task-b", title: "B", description: "", assignee: "builder", priority: "medium", callbackUrl: "http://127.0.0.1:9", message: "Do TASK_B.", worktree: { path: wtB.path, branch: wtB.branch, baseRef: wtB.baseRef } })

  const statusA = join(wtA.path, ".dock-agent-status.json")
  const statusB = join(wtB.path, ".dock-agent-status.json")
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (existsSync(statusA) && existsSync(statusB)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const a = JSON.parse(await readFile(statusA, "utf8"))
  const b = JSON.parse(await readFile(statusB, "utf8"))
  assert.equal(a.ok, true, `agent A finished: ${a.summary}`)
  assert.equal(b.ok, true, `agent B finished: ${b.summary}`)

  // The gateway key never entered either sandbox.
  assert.equal(a.inferenceKeyVisible, false, "agent A env carries no inference key")
  assert.equal(b.inferenceKeyVisible, false, "agent B env carries no inference key")
  // ...but the host-side relay presented it upstream on the agent's behalf.
  assert.ok(authSeen.length >= 2 && authSeen.every((h) => h === "Bearer fictional-key"), "relay added the key host-side")

  // Zero network connections reached the canary (npm test ran in both boxes).
  assert.equal(canaryHits, 0, "no sandbox network egress")

  // Each sibling produced only its own file, in its own worktree.
  assert.equal(await readFile(join(wtA.path, "hello-a.txt"), "utf8"), "done by TASK_A\n")
  assert.equal(await readFile(join(wtB.path, "hello-b.txt"), "utf8"), "done by TASK_B\n")
  await assert.rejects(access(join(wtA.path, "hello-b.txt")), "no sibling file in A")
  await assert.rejects(access(join(wtB.path, "hello-a.txt")), "no sibling file in B")

  // Escape attempts landed nowhere.
  await assert.rejects(access(join(repo, "escape.txt")), "no escape into main checkout")
  await assert.rejects(access(join(dir, "escape.txt")), "no escape above worktree")
  await assert.rejects(access("/tmp/escape-abs.txt"), "no absolute escape visible on host")
  await assert.rejects(access("/etc/pwn.txt"), "no write through symlink to /etc")

  // The mainline ref is untouched by either agent or finalizer.
  assert.equal((await git(repo, ["rev-parse", "HEAD"])).stdout.trim(), mainRefBefore, "mainline ref unchanged")
  // The sibling branch moves only to the SIBLING's own commit, via the host
  // finalizer - never to anything agent A wrote. Wait for B's finalizer.
  const deadlineRefB = Date.now() + 15000
  let branchB = null
  while (Date.now() < deadlineRefB) {
    branchB = (await git(repo, ["rev-parse", "refs/heads/dock/task-task-b"])).stdout.trim()
    if (branchB === b.commitSha) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.equal(branchB, b.commitSha, "sibling branch advanced only to the sibling's own commit")
  assert.notEqual(branchB, a.commitSha, "agent A's commit never appears on the sibling branch")
  await assert.rejects(git(repo, ["merge-base", "--is-ancestor", a.commitSha, "refs/heads/dock/task-task-b"]), "A's commit is not an ancestor of B's branch")
  const configHashAfter = createHash("sha256").update(readFileSync(join(repo, ".git", "config"))).digest("hex")
  assert.equal(configHashAfter, configHashBefore, "git config unchanged")
  const hooksAfter = await readdir(join(repo, ".git", "hooks")).catch(() => [])
  assert.deepEqual(hooksAfter, hooksBefore, "hooks dir unchanged")

  // ...while each task's own branch advanced to exactly the agent's commit,
  // moved by the HOST finalizer from the agent's scratch object store.
  const deadlineRef = Date.now() + 15000
  let branchA = null
  while (Date.now() < deadlineRef) {
    branchA = (await git(repo, ["rev-parse", "refs/heads/dock/task-task-a"])).stdout.trim()
    if (branchA === a.commitSha) break
    await new Promise((r) => setTimeout(r, 250))
  }
  assert.equal(branchA, a.commitSha, "host advanced task-a branch to the agent's commit")
  const parentA = (await git(repo, ["rev-parse", `${a.commitSha}^`])).stdout.trim()
  if (parentA !== mainRefBefore) {
    console.log("DEBUG graph:", (await git(repo, ["log", "--all", "--oneline", "--graph"])).stdout)
    console.log("DEBUG statusA:", JSON.stringify(a))
    console.log("DEBUG calls:", JSON.stringify(calls))
  }
  assert.equal(parentA, mainRefBefore, "agent commit builds on the base ref")
  const logA = (await git(wtA.path, ["log", "--oneline", "-1", a.commitSha])).stdout
  assert.ok(logA.includes("TASK_A"), `branch A commit: ${logA}`)

  // Every scripted adversarial step actually ran.
  assert.ok(calls.filter((c) => c.marker === "TASK_A").length >= 11, "all scripted steps ran for A")
})
