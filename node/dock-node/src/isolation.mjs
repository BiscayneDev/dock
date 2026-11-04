import { lstat, readFile, realpath } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"

// Per-task container confinement for local execution.
//
// Dock's Next.js side creates the per-task worktree and verifies it afterwards,
// but it never spawns the coding agent - that happens on the owner's machine
// (the OpenClaw gateway, default http://127.0.0.1:18789, and this daemon's local
// tools). A worktree is discipline: the agent still runs with the OS user's
// permissions and can read sibling worktrees, shared refs, secrets and services.
// The hard boundary the owner requires is process-level: each task's commands
// run in a fresh container that sees ONLY that task's worktree.
//
// This module is the launch mechanism: runtime detection + argument
// construction. It is deliberately pure so it is testable; the executor decides
// when to require it.

export const CONTAINER_RUNTIMES = ["docker", "podman", "container"] // container = Apple Containerization (macOS)
export const DEFAULT_IMAGE = process.env.DOCK_TASK_IMAGE || "node:22-alpine"

/** First available container runtime, or null. whichFn is injectable for tests. */
export function detectContainerRuntime(whichFn) {
  for (const name of CONTAINER_RUNTIMES) {
    if (whichFn(name)) return name
  }
  return null
}

const IMAGE_REF = /^[a-z0-9][a-z0-9._/:@-]{0,200}$/i

export function isValidImageRef(image) {
  return IMAGE_REF.test(image) && !image.includes("..")
}

/** Owner-registered repos (same file the Dock app writes). */
export async function loadRegisteredRepos(file = join(homedir(), ".config", "dock", "private", "registered-repos.json")) {
  try {
    const data = JSON.parse(await readFile(file, "utf8"))
    return Array.isArray(data) ? data.filter((x) => typeof x === "string") : []
  } catch {
    return []
  }
}

/**
 * Canonical association: resolve symlinks, then require the resolved path to be
 * exactly <registered repo's parent>/.dock-worktrees/<repo basename>/task-<id>
 * for a repo the owner registered. A symlinked or renamed path that does not
 * resolve into that shape is refused, and path components are re-checked AFTER
 * resolution so a symlink swap cannot smuggle a host directory into the mount.
 */
export async function resolveTaskWorktree(worktreePath, registeredRepos, taskRef) {
  if (typeof taskRef !== "string" || !/^task-[a-z0-9][a-z0-9-]{0,62}$/.test(taskRef)) {
    throw new Error(`invalid task ref: ${taskRef}`)
  }
  const stat = await lstat(worktreePath).catch(() => null)
  if (!stat) throw new Error(`worktree path does not exist: ${worktreePath}`)
  const resolved = await realpath(worktreePath)
  for (const repo of registeredRepos) {
    const repoReal = await realpath(repo).catch(() => null)
    if (!repoReal) continue
    const expected = join(dirname(repoReal), ".dock-worktrees", basename(repoReal), taskRef)
    if (resolved === expected) return { resolved, repo: repoReal, taskRef }
  }
  throw new Error(`path is not a task worktree of a registered repo: ${resolved}`)
}

/** Task containers may only ever mount a Dock task worktree. */
export function isTaskWorktreePath(worktreePath) {
  if (!isAbsolute(worktreePath)) return false
  const parts = resolve(worktreePath).split(sep)
  const i = parts.lastIndexOf(".dock-worktrees")
  // .../<repo-parent>/.dock-worktrees/<repo>/<taskId>
  return i > 0 && parts.length === i + 3
}

/**
 * argv (after the runtime binary) for one confined command:
 * fresh container, only the task worktree mounted, at /work, nothing else of the
 * host visible; no network by default; no inherited environment (callers pass
 * scrubEnv output via envFlags); non-root where the runtime supports it.
 */
export function containerRunArgs({ runtime, worktreePath, command, image = DEFAULT_IMAGE, network = false, envFlags = [] }) {
  if (!CONTAINER_RUNTIMES.includes(runtime)) throw new Error(`unknown container runtime: ${runtime}`)
  if (!isTaskWorktreePath(worktreePath)) throw new Error(`refusing to mount non-task-worktree path: ${worktreePath}`)
  if (!Array.isArray(command) || command.length === 0 || command.some((c) => typeof c !== "string" || !c)) {
    throw new Error("command must be a non-empty string array")
  }
  if (!isValidImageRef(image)) throw new Error(`invalid image ref: ${image}`)
  // The mount is the ONLY volume: no docker socket, no host paths, ever. The
  // caller passes a path already canonicalized by resolveTaskWorktree.
  const mount = `${resolve(worktreePath)}:/work`
  const base = ["run", "--rm", "--workdir", "/work", "-v", mount, "--network", network ? "bridge" : "none"]
  if (runtime !== "container") base.push("--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges")
  if (runtime === "docker" || runtime === "podman") {
    const uid = process.getuid?.() ?? 1000
    const gid = process.getgid?.() ?? 1000
    base.push("--user", `${uid}:${gid}`)
  }
  return [...base, ...envFlags, image, ...command]
}

/**
 * Run a task command confined when a runtime exists; refuse otherwise.
 * The caller treats a null return as "cannot enforce isolation here" and must
 * NOT fall back to running the command on the host when isolation is required.
 */
export function confinedCommand({ worktreePath, command, whichFn, image, network, envFlags }) {
  const runtime = detectContainerRuntime(whichFn)
  if (!runtime) return null
  return { runtime, argv: containerRunArgs({ runtime, worktreePath, command, image, network, envFlags }) }
}
