/**
 * Isolated coding runtime: the ONLY built-in runtime that enforces worktree
 * confinement, because it controls the agent process boundary.
 *
 * The agent (scripts/isolated-coding-agent.mjs) is spawned inside bubblewrap:
 * the task worktree is its only writable mount, the main checkout and every
 * sibling worktree are not mounted at all, the environment is scrubbed to the
 * inference credentials it needs, and the process dies with the parent. The
 * agent's own tool layer refuses out-of-worktree paths as a second boundary.
 *
 * enforcesWorktreeIsolation is TRUE only when bubblewrap is actually present
 * (Linux, unprivileged user namespaces). On any other host the constructor
 * leaves it false and activate() fails closed - the same refusal every other
 * runtime gives - rather than silently running unconfined.
 *
 * Inference goes to Dock's configured gateway (SHIPYARD_INFERENCE_URL /
 * SHIPYARD_INFERENCE_API_KEY), the same inference access every other runtime
 * uses; nothing else about the host's credentials is visible to the agent.
 */
import { spawn, execFileSync, type ChildProcess } from "child_process"
import { existsSync, readFileSync } from "fs"
import { dirname } from "path"
import { resolve } from "path"
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

export class IsolatedRuntime implements AgentRuntime {
  readonly name = "Isolated (bubblewrap-confined coding agent)"
  readonly id = "isolated"
  readonly enforcesWorktreeIsolation: boolean
  private bwrap: string | null
  private children = new Set<ChildProcess>()

  constructor() {
    this.bwrap = bwrapPath()
    this.enforcesWorktreeIsolation = this.bwrap !== null
  }

  async healthCheck(): Promise<{ ok: boolean; version?: string; error?: string }> {
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

  async chat(_params: ChatParams): Promise<string> {
    return "The isolated runtime only runs confined task activations; chat goes through the default runtime."
  }

  async activate(params: ActivateParams & { message: string }): Promise<void> {
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
    // A linked worktree's .git is a FILE pointing at the main repo's git dir
    // (gitdir: <abs path>). Mount that git dir at its own absolute path so git
    // works inside the sandbox; the main checkout's files stay unmounted.
    const gitPointer = readFileSync(resolve(worktree.path, ".git"), "utf8").trim()
    const m = gitPointer.match(/^gitdir:\s*(.+)$/)
    if (!m) throw new Error(`unrecognized worktree .git pointer: ${gitPointer}`)
    const mainGitDir = resolve(m[1], "..", "..")
    const args = [
      "--die-with-parent",
      "--unshare-pid", "--unshare-uts", "--unshare-ipc", "--unshare-cgroup",
      "--share-net", // inference egress only; every other credential is scrubbed below
      "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
      "--ro-bind", "/usr", "/usr", "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/lib", "/lib",
      // DNS + CA certs for the inference call.
      "--ro-bind", "/etc", "/etc",
      // The agent runner itself, read-only.
      "--ro-bind", runner, runner,
      // Node on this platform links lib64; bind when present.
      ...(existsSync("/lib64") ? ["--ro-bind", "/lib64", "/lib64"] : []),
      // The task worktree: the ONLY writable mount.
      "--bind", worktree.path, worktree.path,
      // The worktree's .git file points into the main repo's git dir; mount
      // that git dir read-write so status/add/commit work. The main checkout
      // and sibling worktrees stay unmounted.
      "--bind", mainGitDir, mainGitDir,
      "--chdir", worktree.path,
      "--setenv", "PATH", "/usr/bin:/bin",
      "--setenv", "HOME", "/tmp",
      "--setenv", "DOCK_WORKTREE_PATH", worktree.path,
      "--setenv", "DOCK_TASK_BRIEF", params.message,
      "--setenv", "SHIPYARD_INFERENCE_URL", inferenceUrl,
      "--setenv", "SHIPYARD_INFERENCE_API_KEY", process.env.SHIPYARD_INFERENCE_API_KEY ?? "",
      ...(process.env.DOCK_AGENT_MODEL ? ["--setenv", "DOCK_AGENT_MODEL", process.env.DOCK_AGENT_MODEL] : []),
      "--",
      nodeBin, runner,
    ]
    const child = spawn(this.bwrap, args, { stdio: ["ignore", "inherit", "inherit"] })
    this.children.add(child)
    child.on("exit", () => this.children.delete(child))
  }

  async testDelivery(): Promise<void> {
    const health = await this.healthCheck()
    if (!health.ok) throw new Error(health.error ?? "unhealthy")
  }
}
