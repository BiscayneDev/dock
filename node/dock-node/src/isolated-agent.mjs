// Home-host execution of isolated coding tasks (the container counterpart of
// the Dock web app's experimental bubblewrap "isolated" runtime).
//
// Flow: canonicalize the task worktree against the owner's registered repos,
// stage the agent runner INTO the worktree (keeps the single-worktree mount
// rule), build a per-run scratch git view (scratch refs + object store, so
// shared git state is never writable), host a unix-socket inference relay
// that holds the gateway key, run the agent in a fresh container with no
// network, then - as the HOST - migrate the agent's objects and advance the
// task branch. Fail-closed everywhere: no container runtime, no launch.
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, existsSync, readFileSync, rmSync, unlinkSync, renameSync } from "node:fs"
import { readFile, mkdir, copyFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, dirname, basename, resolve } from "node:path"
import { execFile, execFileSync, spawn as defaultSpawn } from "node:child_process"
import { promisify } from "node:util"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { detectContainerRuntime, containerIsolatedAgentArgs, resolveTaskWorktree } from "./isolation.mjs"

const execFileAsync = promisify(execFile)
const RUNNER_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/isolated-coding-agent.mjs")

function seedLooseRefs(srcRefsDir, dstRefsDir, rel = "") {
  let entries
  try { entries = readdirSync(join(srcRefsDir, rel), { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) seedLooseRefs(srcRefsDir, dstRefsDir, r)
    else {
      mkdirSync(dirname(join(dstRefsDir, r)), { recursive: true })
      copyFileSync(join(srcRefsDir, r), join(dstRefsDir, r))
    }
  }
}

function sanitizedConfig(mainGitDir) {
  let original = ""
  try { original = readFileSync(join(mainGitDir, "config"), "utf8") } catch { original = "" }
  const keep = ["[core]", "\trepositoryformatversion = 0", "\tbare = false", "\tlogallrefupdates = false"]
  const version = original.match(/repositoryformatversion\s*=\s*(\d+)/)
  if (version) keep[1] = `\trepositoryformatversion = ${version[1]}`
  const ext = original.match(/\[extensions\]([\s\S]*?)(?=\n\[|$)/)
  if (ext) keep.push("[extensions]", ...ext[1].split("\n").filter((l) => l.trim()))
  keep.push("[user]", "\tname = Dock Isolated Agent", "\temail = dock-agent@localhost")
  return keep.join("\n") + "\n"
}

function migrateObjects(scratchObjects, mainObjects, rel = "") {
  let entries
  try { entries = readdirSync(join(scratchObjects, rel), { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) migrateObjects(scratchObjects, mainObjects, r)
    else {
      const dst = join(mainObjects, r)
      mkdirSync(dirname(dst), { recursive: true })
      try { renameSync(join(scratchObjects, r), dst) } catch { /* content-identical object already present */ }
    }
  }
}

/** Host-side relay: only POST /v1/chat/completions, key added here. */
export function startInferenceRelay(sockPath, upstreamUrl, apiKey) {
  const upstream = upstreamUrl.replace(/\/$/, "") + "/v1/chat/completions"
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404
      res.end()
      return
    }
    const chunks = []
    let size = 0
    req.on("data", (c) => {
      size += c.length
      if (size > 8_000_000) req.destroy()
      else chunks.push(c)
    })
    req.on("end", async () => {
      try {
        const upstreamRes = await fetch(upstream, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: Buffer.concat(chunks),
        })
        res.statusCode = upstreamRes.status
        res.setHeader("Content-Type", "application/json")
        res.end(Buffer.from(await upstreamRes.arrayBuffer()))
      } catch {
        res.statusCode = 502
        res.end(JSON.stringify({ error: "relay upstream failed" }))
      }
    })
  })
  server.listen(sockPath)
  return server
}

/**
 * Run one isolated coding task on the home host. Throws (fails closed) when
 * no container runtime exists or the worktree fails canonical validation.
 * spawnFn is injectable for tests: it receives (runtimeBinary, argv, env) and
 * must return a ChildProcess-like with once("exit", cb).
 */
export async function runIsolatedAgentTask({
  taskRef,
  worktreePath,
  brief,
  registeredRepos,
  image,
  env = process.env,
  whichFn = (name) => { try { execFileSync("which", [name], { stdio: "ignore" }); return true } catch { return false } },
  spawnFn = (bin, argv, envVars) => defaultSpawn(bin, argv, { stdio: ["ignore", "inherit", "inherit"], env: envVars }),
  log = () => {},
}) {
  if (!brief || typeof brief !== "string") throw new Error("isolated agent task requires a brief")
  const { resolved, repo } = await resolveTaskWorktree(worktreePath, registeredRepos, taskRef)
  const mainGitDir = join(repo, ".git")
  const worktreeGitDir = join(mainGitDir, "worktrees", basename(resolved))
  if (!existsSync(worktreeGitDir)) throw new Error(`worktree gitdir missing: ${worktreeGitDir}`)

  const runtime = detectContainerRuntime(whichFn)
  if (!runtime) throw new Error("no container runtime on this host; refusing unconfined launch")

  const inferenceUrl = env.SHIPYARD_INFERENCE_URL
  if (!inferenceUrl) throw new Error("SHIPYARD_INFERENCE_URL is not configured")

  // Per-run scratch git view + relay socket.
  const scratch = mkdtempSync(join(tmpdir(), "dock-isolated-"))
  mkdirSync(join(scratch, "objects"), { recursive: true })
  mkdirSync(join(scratch, "refs"), { recursive: true })
  seedLooseRefs(join(mainGitDir, "refs"), join(scratch, "refs"))
  writeFileSync(join(scratch, "config"), sanitizedConfig(mainGitDir))
  const sockPath = join(scratch, "infer.sock")
  const relay = startInferenceRelay(sockPath, inferenceUrl, env.SHIPYARD_INFERENCE_API_KEY ?? "")

  // Stage the runner inside the worktree (single-mount rule).
  await mkdir(join(resolved, ".dock"), { recursive: true })
  await copyFile(RUNNER_SOURCE, join(resolved, ".dock", "agent.mjs"))

  const envVars = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    DOCK_WORKTREE_PATH: resolved,
    DOCK_TASK_BRIEF: brief,
    SHIPYARD_INFERENCE_URL: "unix:///run/dock-infer.sock",
    GIT_OBJECT_DIRECTORY: join(scratch, "objects"),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(mainGitDir, "objects"),
    ...(env.DOCK_AGENT_MODEL ? { DOCK_AGENT_MODEL: env.DOCK_AGENT_MODEL } : {}),
  }
  const argv = containerIsolatedAgentArgs({
    runtime, repoPath: repo, worktreePath: resolved, worktreeGitDir, mainGitDir,
    scratchDir: scratch, socketPath: sockPath, hasPackedRefs: existsSync(join(mainGitDir, "packed-refs")),
    image, envFlags: [],
  })
  log(`isolated task ${taskRef}: launching ${runtime} container`)
  const child = spawnFn(runtime, argv, envVars)
  const exitCode = await new Promise((resolvePromise) => child.once("exit", (code) => resolvePromise(code ?? 1)))

  let status = { ok: false, summary: `container exited ${exitCode} without a status file` }
  try {
    status = JSON.parse(await readFile(join(resolved, ".dock-agent-status.json"), "utf8"))
  } catch { /* keep default */ }

  if (status?.ok && typeof status.commitSha === "string" && /^[0-9a-f]{40}$/.test(status.commitSha)) {
    migrateObjects(join(scratch, "objects"), join(mainGitDir, "objects"))
    await execFileAsync("git", [`--git-dir=${mainGitDir}`, "update-ref", `refs/heads/dock/task-${taskRef}`, status.commitSha])
    log(`isolated task ${taskRef}: branch advanced to ${status.commitSha.slice(0, 8)}`)
  }
  relay.close()
  try { unlinkSync(sockPath) } catch { /* already gone */ }
  rmSync(scratch, { recursive: true, force: true })
  return { ...status, exitCode }
}
