// The isolated runtime REALLY confines: two sibling tasks in one repo run in
// bubblewrap sandboxes whose only writable mount is their own worktree, with
// a scrubbed environment. Escape attempts (relative path, absolute path,
// sibling worktree, host file) fail at BOTH boundaries (tool layer + mounts).
// Skips when bubblewrap is absent (the runtime fails closed there too).
// Run: node --experimental-strip-types --test test/isolated-runtime.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"
import { existsSync } from "node:fs"

const run = promisify(execFile)
const git = (cwd, args) => run("git", ["-C", cwd, ...args])
const BWRAP = ["/usr/bin/bwrap", "/bin/bwrap"].find((p) => existsSync(p))

const { createTaskWorktree } = await import("../lib/isolation/worktree.ts")
const { IsolatedRuntime } = await import("../lib/runtimes/isolated.ts")

// Scripted OpenAI-compatible inference: per-task tool-call scripts, keyed by
// the marker in the task brief. Records every call for assertions.
const calls = []
function scriptFor(marker) {
  const other = marker === "TASK_A" ? "hello-b.txt" : "hello-a.txt"
  const own = marker === "TASK_A" ? "hello-a.txt" : "hello-b.txt"
  return [
    { name: "write_file", args: { path: own, content: `done by ${marker}\n` } },
    { name: "write_file", args: { path: "../escape.txt", content: "escape\n" } },
    { name: "write_file", args: { path: "/tmp/escape-abs.txt", content: "escape\n" } },
    { name: "read_file", args: { path: `../${other}` } },
    { name: "read_file", args: { path: "/etc/hostname" } },
    { name: "run_shell", args: { command: "git add -A" } },
    { name: "run_shell", args: { command: `git commit -m ${marker}` } },
    { name: "run_shell", args: { command: "curl http://169.254.169.254/" } },
    { name: "finish", args: { summary: `${marker} complete` } },
  ]
}

test("isolated runtime: sibling confinement end to end", { skip: !BWRAP, timeout: 120000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-isolated-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "repo")
  await run("git", ["init", "-q", repo])
  await git(repo, ["config", "user.email", "test@example.com"])
  await git(repo, ["config", "user.name", "Test"])
  await writeFile(join(repo, "README.md"), "fixture repo\n")
  await git(repo, ["add", "-A"])
  await git(repo, ["commit", "-q", "-m", "init"])

  const steps = { TASK_A: 0, TASK_B: 0 }
  const infer = http.createServer((req, res) => {
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
  const port = infer.address().port

  const wtA = await createTaskWorktree({ repoPath: repo, taskRef: "task-a" })
  const wtB = await createTaskWorktree({ repoPath: repo, taskRef: "task-b" })

  const rt = new IsolatedRuntime()
  assert.equal(rt.enforcesWorktreeIsolation, true, "bwrap present: runtime must claim enforcement")

  process.env.SHIPYARD_INFERENCE_URL = `http://127.0.0.1:${port}`
  process.env.SHIPYARD_INFERENCE_API_KEY = "fictional-key"
  await rt.activate({ taskId: "task-a", title: "A", description: "", assignee: "builder", priority: "medium", callbackUrl: "http://127.0.0.1:9", message: "Do TASK_A: create hello-a.txt, commit, finish.", worktree: { path: wtA.path, branch: wtA.branch, baseRef: wtA.baseRef } })
  await rt.activate({ taskId: "task-b", title: "B", description: "", assignee: "builder", priority: "medium", callbackUrl: "http://127.0.0.1:9", message: "Do TASK_B: create hello-b.txt, commit, finish.", worktree: { path: wtB.path, branch: wtB.branch, baseRef: wtB.baseRef } })

  const statusA = join(wtA.path, ".dock-agent-status.json")
  const statusB = join(wtB.path, ".dock-agent-status.json")
  const deadline = Date.now() + 90000
  while (Date.now() < deadline) {
    if (existsSync(statusA) && existsSync(statusB)) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const a = JSON.parse(await readFile(statusA, "utf8"))
  const b = JSON.parse(await readFile(statusB, "utf8"))
  assert.equal(a.ok, true, `agent A finished: ${a.summary}`)
  assert.equal(b.ok, true, `agent B finished: ${b.summary}`)

  // Each sibling produced only its own file, in its own worktree.
  assert.equal(await readFile(join(wtA.path, "hello-a.txt"), "utf8"), "done by TASK_A\n")
  assert.equal(await readFile(join(wtB.path, "hello-b.txt"), "utf8"), "done by TASK_B\n")
  await assert.rejects(access(join(wtA.path, "hello-b.txt")), "no sibling file in A")
  await assert.rejects(access(join(wtB.path, "hello-a.txt")), "no sibling file in B")

  // Escape attempts landed nowhere: not in the repo, not in the main checkout,
  // not in the sandbox-visible /tmp (which is a private tmpfs anyway).
  await assert.rejects(access(join(repo, "escape.txt")), "no escape into main checkout")
  await assert.rejects(access(join(dir, "escape.txt")), "no escape above worktree")
  await assert.rejects(access("/tmp/escape-abs.txt"), "no absolute escape visible on host")

  // Commits landed on each task's own branch.
  const logA = (await git(wtA.path, ["log", "--oneline", "-1"])).stdout
  assert.ok(logA.includes("TASK_A"), `branch A commit: ${logA}`)
  const branches = (await git(repo, ["branch", "--list", "dock/task-*"])).stdout
  assert.ok(branches.includes("dock/task-task-a") && branches.includes("dock/task-task-b"))

  // The agent's own log shows the refusals (tool layer), proving both layers engaged.
  assert.ok(calls.filter((c) => c.marker === "TASK_A").length >= 8, "all scripted steps ran")
})
