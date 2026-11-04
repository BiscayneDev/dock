/**
 * Isolated coding runtime: the ONLY built-in runtime that enforces worktree
 * confinement, because it controls the agent process boundary.
 *
 * The agent (scripts/isolated-coding-agent.mjs) is spawned inside bubblewrap:
 *
 *  - FILESYSTEM: the task worktree is the only writable host directory. The
 *    main checkout and every sibling worktree are not mounted at all. The
 *    main gitdir is mounted READ-ONLY piecewise (objects via GIT_ALTERNATE,
 *    sanitized config without aliases/urls/hooksPath, packed-refs, HEAD);
 *    hooks are not mounted. The agent's own commits write objects into a
 *    per-run scratch dir (GIT_OBJECT_DIRECTORY) and refs into a scratch copy;
 *    nothing the agent writes can touch shared refs, shared objects, hooks,
 *    or config. On clean exit the HOST migrates scratch objects and advances
 *    the task branch ref itself (finalizeRun).
 *  - NETWORK: --unshare-net. The only connectivity is a unix socket relay
 *    (bind-mounted at /run/dock-infer.sock) that accepts POST
 *    /v1/chat/completions and forwards it to the configured gateway, adding
 *    the API key HOST-SIDE. The agent environment never carries the key and
 *    the sandbox has no route to anything else.
 *  - /etc is not mounted: symlinked paths to host config dangle, and the
 *    runner's realpath check refuses symlink escapes at the tool layer too.
 *
 * enforcesWorktreeIsolation is TRUE only when bubblewrap is actually present
 * (Linux, unprivileged user namespaces). On any other host the constructor
 * leaves it false and activate() fails closed - the same refusal every other
 * runtime gives - rather than silently running unconfined.
 *
 * Inference goes to Dock's configured gateway (SHIPYARD_INFERENCE_URL /
 * SHIPYARD_INFERENCE_API_KEY) through the host-side relay; the gateway secret
 * never enters the sandbox.
 */
import { spawn, execFileSync, type ChildProcess } from "child_process"
import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, unlinkSync, renameSync } from "fs"
import { readFile } from "fs/promises"
import { tmpdir } from "os"
import { join, resolve, relative, dirname, basename } from "path"
import { randomBytes } from "crypto"
import http from "http"
import type { AgentRuntime, RuntimeSession, ActivateParams, ChatParams } from "./types"

function bwrapPath(): string | null {
  if (process.env.DOCK_ISOLATED_BWRAP === "off") return null
  for (const p of [process.env.DOCK_BWRAP_PATH, "/usr/bin/bwrap", "/bin/bwrap"]) {
    if (p && existsSync(p)) return p
  }
  try {
    return execFileSync("which", ["bwrap"], { encoding: "utf8" }).trim() || null
  } catch {
    return null
  }
}

/** Copy every loose ref so the agent sees the repo's refs in its scratch view. */
function seedLooseRefs(srcRefsDir: string, dstRefsDir: string, rel = ""): void {
  let entries: import("fs").Dirent[]
  try {
    entries = readdirSync(join(srcRefsDir, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) seedLooseRefs(srcRefsDir, dstRefsDir, r)
    else {
      mkdirSync(dirname(join(dstRefsDir, r)), { recursive: true })
      copyFileSync(join(srcRefsDir, r), join(dstRefsDir, r))
    }
  }
}

/**
 * Minimal git config for the sandbox: repository format (+ extensions the repo
 * requires) and a deterministic identity. Aliases, url rewrites, credential
 * helpers, hooksPath, sshCommand and includes are all dropped.
 */
function sanitizedConfig(mainGitDir: string): string {
  let original = ""
  try {
    original = readFileSync(join(mainGitDir, "config"), "utf8")
  } catch {
    original = ""
  }
  const keep: string[] = ["[core]", "\trepositoryformatversion = 0", "\tbare = false", "\tlogallrefupdates = false"]
  const version = original.match(/repositoryformatversion\s*=\s*(\d+)/)
  if (version) keep[1] = `\trepositoryformatversion = ${version[1]}`
  const ext = original.match(/\[extensions\]([\s\S]*?)(?=\n\[|$)/)
  if (ext) keep.push("[extensions]", ...ext[1].split("\n").filter((l) => l.trim()))
  keep.push("[user]", "\tname = Dock Isolated Agent", "\temail = dock-agent@localhost")
  return keep.join("\n") + "\n"
}

/** Move scratch objects into the shared store (content-addressed; collisions skipped). */
function migrateObjects(scratchObjects: string, mainObjects: string, rel = ""): void {
  let entries: import("fs").Dirent[]
  try {
    entries = readdirSync(join(scratchObjects, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      migrateObjects(scratchObjects, mainObjects, r)
    } else {
      const dst = join(mainObjects, r)
      mkdirSync(dirname(dst), { recursive: true })
      try {
        renameSync(join(scratchObjects, r), dst)
      } catch {
        /* EEXIST: object already present, content-identical */
      }
    }
  }
}

/** Host-side relay: only POST /v1/chat/completions, key added here, never in the sandbox. */
function startInferenceRelay(sockPath: string, upstreamUrl: string, apiKey: string): http.Server {
  const upstream = upstreamUrl.replace(/\/$/, "") + "/v1/chat/completions"
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404
      res.end()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (c: Buffer) => {
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

export class IsolatedRuntime implements AgentRuntime {
  readonly name = "Isolated (bubblewrap-confined coding agent)"
  readonly id = "isolated"
  readonly enforcesWorktreeIsolation: boolean
  private bwrap: string | null
  private children = new Set<ChildProcess>()

  constructor() {
    // EXPERIMENTAL: off by default until security review clears a head that
    // includes this runtime. With the flag unset it behaves exactly like the
    // pre-runtime state: unavailable, and activate() refuses safely.
    this.enabled = process.env.DOCK_ISOLATED_RUNTIME === "on"
    this.bwrap = this.enabled ? bwrapPath() : null
    this.enforcesWorktreeIsolation = this.bwrap !== null
  }
  private enabled: boolean

  async healthCheck(): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (!this.enabled) return { ok: false, error: "experimental runtime disabled (DOCK_ISOLATED_RUNTIME != on)" }
    if (!this.bwrap) return { ok: false, error: "bubblewrap not found on this host" }
    try {
      const version = execFileSync(this.bwrap, ["--version"], { encoding: "utf8" }).trim()
      return { ok: true, version }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "bwrap check failed" }
    }
  }

  async listSessions(): Promise<RuntimeSession[]> {
    return [...this.children].map((c, i) => ({ key: `isolated-${i}`, sessionId: String(c.pid ?? i), kind: "agent" }))
  }

  async testDelivery(): Promise<void> {
    throw new Error("isolated runtime has no delivery channel; task activations only")
  }

  async chat(_params: ChatParams): Promise<string> {
    return "The isolated runtime only runs confined task activations; chat goes through the default runtime."
  }

  async activate(params: ActivateParams & { message: string }): Promise<void> {
    if (!this.enabled) {
      throw new Error("isolated runtime is experimental and disabled (set DOCK_ISOLATED_RUNTIME=on to enable); refusing launch")
    }
    if (!this.bwrap || !this.enforcesWorktreeIsolation) {
      throw new Error("isolated runtime unavailable: bubblewrap not found on this host; refusing unconfined launch")
    }
    const worktree = params.worktree
    if (!worktree?.path) {
      throw new Error("isolated runtime requires a task worktree; refusing unconfined launch")
    }
    const inferenceUrl = process.env.SHIPYARD_INFERENCE_URL
    if (!inferenceUrl) throw new Error("SHIPYARD_INFERENCE_URL is not configured")

    const nodeBin = process.execPath
    const runner = resolve(process.cwd(), "scripts/isolated-coding-agent.mjs")
    // A linked worktree's .git is a FILE pointing at its per-worktree git dir.
    const gitPointer = readFileSync(resolve(worktree.path, ".git"), "utf8").trim()
    const m = gitPointer.match(/^gitdir:\s*(.+)$/)
    if (!m) throw new Error(`unrecognized worktree .git pointer: ${gitPointer}`)
    const worktreeGitDir = resolve(m[1])
    const mainGitDir = resolve(worktreeGitDir, "..", "..")

    // Per-run scratch: the agent's objects and ref updates land here, never in
    // the shared store. The host finalizer migrates them after a clean exit.
    const scratch = mkdtempSync(join(tmpdir(), "dock-isolated-"))
    mkdirSync(join(scratch, "objects"), { recursive: true })
    mkdirSync(join(scratch, "refs"), { recursive: true })
    seedLooseRefs(join(mainGitDir, "refs"), join(scratch, "refs"))
    const configPath = join(scratch, "config")
    const { writeFileSync } = await import("fs")
    writeFileSync(configPath, sanitizedConfig(mainGitDir))

    const sockPath = join(scratch, "infer.sock")
    const relay = startInferenceRelay(sockPath, inferenceUrl, process.env.SHIPYARD_INFERENCE_API_KEY ?? "")
    const sandboxSock = "/run/dock-infer.sock"

    const args = [
      "--die-with-parent",
      "--clearenv",
      "--unshare-pid", "--unshare-uts", "--unshare-ipc", "--unshare-cgroup", "--unshare-net",
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/lib", "/lib",
      ...(existsSync("/lib64") ? ["--ro-bind", "/lib64", "/lib64"] : []),
      // The agent runner itself, read-only.
      "--ro-bind", runner, runner,
      // The task worktree: the ONLY writable host directory.
      "--bind", worktree.path, worktree.path,
      // Per-worktree git metadata (HEAD, index) - private to this task.
      "--bind", worktreeGitDir, worktreeGitDir,
      // Shared object store, read-only (reachable via GIT_ALTERNATE below).
      "--ro-bind", join(mainGitDir, "objects"), join(mainGitDir, "objects"),
      // Agent-visible refs: a scratch copy (its updates die here unless finalized).
      "--bind", join(scratch, "refs"), join(mainGitDir, "refs"),
      ...(existsSync(join(mainGitDir, "packed-refs")) ? ["--ro-bind", join(mainGitDir, "packed-refs"), join(mainGitDir, "packed-refs")] : []),
      "--ro-bind", join(mainGitDir, "HEAD"), join(mainGitDir, "HEAD"),
      "--ro-bind", configPath, join(mainGitDir, "config"),
      // Scratch object store, writable.
      "--bind", join(scratch, "objects"), join(scratch, "objects"),
      // Inference relay socket: the sandbox's only connectivity.
      "--bind", sockPath, sandboxSock,
      "--chdir", worktree.path,
      "--setenv", "PATH", "/usr/bin:/bin",
      "--setenv", "HOME", "/tmp",
      "--setenv", "DOCK_WORKTREE_PATH", worktree.path,
      "--setenv", "DOCK_TASK_BRIEF", params.message,
      "--setenv", "SHIPYARD_INFERENCE_URL", `unix://${sandboxSock}`,
      "--setenv", "GIT_OBJECT_DIRECTORY", join(scratch, "objects"),
      "--setenv", "GIT_ALTERNATE_OBJECT_DIRECTORIES", join(mainGitDir, "objects"),
      ...(process.env.DOCK_AGENT_MODEL ? ["--setenv", "DOCK_AGENT_MODEL", process.env.DOCK_AGENT_MODEL] : []),
      "--",
      nodeBin, runner,
    ]
    const child = spawn(this.bwrap, args, { stdio: ["ignore", "inherit", "inherit"] })
    this.children.add(child)
    child.on("exit", () => {
      this.children.delete(child)
      this.finalizeRun(worktree, mainGitDir, scratch, sockPath, relay).catch(() => null)
    })
  }

  /**
   * After the agent exits: read its status, migrate its objects into the
   * shared store, and advance the task branch to its final commit. The agent
   * could not do any of this itself - the shared store was read-only to it.
   */
  private async finalizeRun(
    worktree: { path: string; branch: string },
    mainGitDir: string,
    scratch: string,
    sockPath: string,
    relay: http.Server,
  ): Promise<void> {
    try {
      const status = JSON.parse(await readFile(join(worktree.path, ".dock-agent-status.json"), "utf8"))
      if (status?.ok && typeof status.commitSha === "string" && /^[0-9a-f]{40}$/.test(status.commitSha)) {
        migrateObjects(join(scratch, "objects"), join(mainGitDir, "objects"))
        execFileSync("git", [`--git-dir=${mainGitDir}`, "update-ref", `refs/heads/${worktree.branch}`, status.commitSha])
      }
    } catch {
      /* finalize is best-effort; the status file remains the record */
    } finally {
      relay.close()
      try { unlinkSync(sockPath) } catch { /* already gone */ }
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}
