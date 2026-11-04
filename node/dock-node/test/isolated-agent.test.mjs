// Full home-host orchestration, everything real except the container itself:
// the injected spawnFn runs the STAGED agent process directly with the env the
// container would get, so staging, scratch git view, relay (key host-side),
// and host-side finalization all execute for real. The container boundary is
// covered at argv level in isolated-agent-argv.test.mjs and by the bwrap
// sibling proof in test/isolated-runtime.test.mjs (Dock web side).
// Run: node --test node/dock-node/test/isolated-agent.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFile, spawn } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"
import { existsSync } from "node:fs"
import { runIsolatedAgentTask } from "../src/isolated-agent.mjs"

const execFileAsync = promisify(execFile)
const git = (cwd, args) => execFileAsync("git", ["-C", cwd, ...args]).then((r) => r.stdout.trim())

test("home-host isolated task: staged agent runs, key stays host-side, host advances branch", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dock-node-iso-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, "proj", "myrepo")
  await execFileAsync("mkdir", ["-p", repo])
  await git(repo, ["init", "-q"])
  await git(repo, ["config", "user.email", "t@e.co"])
  await git(repo, ["config", "user.name", "T"])
  await writeFile(join(repo, "README.md"), "x\n")
  await git(repo, ["add", "-A"])
  await git(repo, ["commit", "-q", "-m", "init"])
  const base = await git(repo, ["rev-parse", "HEAD"])
  const wt = join(dir, "proj", ".dock-worktrees", "myrepo", "task-1")
  await git(repo, ["worktree", "add", "-q", "-b", "dock/task-task-1", wt, "HEAD"])

  // Scripted upstream inference (what the relay forwards to).
  const authSeen = []
  const steps = [
    { name: "write_file", args: { path: "feature.txt", content: "built at home\n" } },
    { name: "run_shell", args: { command: "git add feature.txt" } },
    { name: "run_shell", args: { command: "git commit -m TASK_ONE" } },
    { name: "finish", args: { summary: "feature built" } },
  ]
  let step = 0
  const upstream = http.createServer((req, res) => {
    authSeen.push(req.headers.authorization ?? null)
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const call = steps[Math.min(step++, steps.length - 1)]
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `c${step}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }))
    })
  })
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r))
  t.after(() => upstream.close())

  let capturedArgv = null
  // Fake the container: run the staged agent with the container's env, but map
  // the in-container socket path to the real relay socket (the container's -v
  // mount would do that).
  const fakeSpawn = (bin, argv, envVars) => {
    capturedArgv = argv.join(" ")
    const wtFromArgv = argv[argv.indexOf("--workdir") + 1]
    const sockHost = argv.find((a) => a.endsWith(":/run/dock-infer.sock")).split(":")[0]
    return spawn(process.execPath, [join(wtFromArgv, ".dock", "agent.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...envVars, SHIPYARD_INFERENCE_URL: `unix://${sockHost}` },
    })
  }

  const result = await runIsolatedAgentTask({
    taskRef: "task-1",
    worktreePath: wt,
    brief: "Build the feature.",
    registeredRepos: [repo],
    whichFn: (n) => n === "docker",
    spawnFn: fakeSpawn,
    env: { DOCK_ISOLATED_RUNTIME: "on", SHIPYARD_INFERENCE_URL: `http://127.0.0.1:${upstream.address().port}`, SHIPYARD_INFERENCE_API_KEY: "fictional-key" },
  })

  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.summary, "feature built")
  assert.equal(result.inferenceKeyVisible, false, "key never in the agent environment")
  assert.ok(authSeen.length >= 1 && authSeen.every((h) => h === "Bearer fictional-key"), "relay added key host-side")
  assert.equal(await readFile(join(wt, "feature.txt"), "utf8"), "built at home\n")
  assert.ok(existsSync(join(wt, ".dock", "agent.mjs")), "runner staged inside the worktree")

  // Host finalizer advanced ONLY the task branch, to the agent's commit, on base.
  const branchTip = await git(repo, ["rev-parse", "refs/heads/dock/task-task-1"])
  assert.equal(branchTip, result.commitSha)
  assert.equal(await git(repo, ["rev-parse", `${result.commitSha}^`]), base)
  assert.equal(await git(repo, ["rev-parse", "HEAD"]), base, "mainline untouched")

  // Scratch cleaned up (socket path captured from argv is inside it).
  const scratchPath = capturedArgv.match(/-v (\/\S*dock-isolated-[^:\s]+)\/refs:/)?.[1]
  assert.ok(scratchPath, "scratch path visible in argv")
  assert.equal(existsSync(scratchPath), false, "scratch dir removed after finalize")
  assert.ok(capturedArgv.includes("--network none"), capturedArgv)
})

test("home-host isolated task fails closed without a container runtime", async () => {
  await assert.rejects(
    runIsolatedAgentTask({ taskRef: "task-1", worktreePath: "/x/.dock-worktrees/y/task-1", brief: "b", registeredRepos: [], whichFn: () => false, env: {} }),
    /experimental isolated runtime disabled|worktree path does not exist|not a task worktree|no container runtime/,
  )
})
