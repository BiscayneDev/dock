/**
 * Isolated task runs (P3): per-task git worktree + branch.
 *
 * Every coding task can run in its own git worktree on its own branch, so sibling
 * agents never share a checkout. Integration happens at a reviewed merge, never in
 * a shared directory.
 *
 * Discipline vs enforcement - read before relying on this:
 * A worktree separates the working files, the branch and the index. Per git's own
 * docs, worktrees SHARE the repository's object store, refs, config and hooks, and
 * an agent process runs with the OS user's permissions: nothing in git stops it
 * from reading a sibling worktree's directory, mutating shared refs, or touching
 * services and secrets outside the repo. This module is the discipline layer. A
 * hard no-crossover boundary additionally needs process-level isolation (a
 * separate container or OS user per agent), scoped credentials, and deny rules on
 * shared services - that layer is deliberately out of scope here.
 *
 * Pure helpers are I/O-free so node tests can load this file directly.
 */

import { realpath } from "node:fs/promises"
import { execFile } from "child_process"
import { promisify } from "util"
import { dirname, basename, join, resolve, sep } from "path"

const execFileAsync = promisify(execFile)

export const TASK_BRANCH_PREFIX = "dock/task-"

/** Task refs become branch names and path components: keep them conservative. */
const TASK_REF = /^[a-z0-9][a-z0-9-]{0,62}$/

export function isValidTaskRef(taskRef: string): boolean {
  return TASK_REF.test(taskRef)
}

/** Base refs come from HTTP input and become git CLI arguments: validate strictly. */
const BASE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,198}$/
const BASE_REF_BAD = /(\.\.|@\{|[\s~^:?*\[\\\\])/

export function isValidBaseRef(ref: string): boolean {
  return BASE_REF.test(ref) && !BASE_REF_BAD.test(ref) && !ref.endsWith("/") && !ref.endsWith(".lock")
}

export function assertValidBaseRef(ref: string): string {
  if (!isValidBaseRef(ref)) throw new Error(`invalid base ref: ${ref}`)
  return ref
}

export function taskBranchName(taskRef: string): string {
  if (!isValidTaskRef(taskRef)) throw new Error(`invalid task ref: ${taskRef}`)
  return `${TASK_BRANCH_PREFIX}${taskRef}`
}

/** Worktrees live next to the repo, never inside the main checkout. */
export function worktreeRootFor(repoPath: string): string {
  const abs = resolve(repoPath)
  return join(dirname(abs), ".dock-worktrees", basename(abs))
}

export function worktreePathFor(repoPath: string, taskRef: string): string {
  if (!isValidTaskRef(taskRef)) throw new Error(`invalid task ref: ${taskRef}`)
  return join(worktreeRootFor(repoPath), taskRef)
}

/** True when candidate is root itself or lives under it. Guards cleanup against path escapes. */
export function isPathInside(root: string, candidate: string): boolean {
  const r = resolve(root)
  const c = resolve(candidate)
  return c === r || c.startsWith(r + sep)
}

/**
 * Environment for anything spawned inside a task worktree: an allowlist, not the
 * parent's full environment, so agent child processes do not inherit API keys or
 * tokens by accident. Callers pass extraKeep for variables a tool genuinely needs.
 */
export const BASE_ENV_KEEP = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "SHELL", "USER", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]

export function scrubEnv(
  env: NodeJS.ProcessEnv,
  extraKeep: readonly string[] = [],
): Record<string, string> {
  const keep = new Set([...BASE_ENV_KEEP, ...extraKeep])
  const out: Record<string, string> = {}
  for (const key of keep) {
    const value = env[key]
    if (typeof value === "string") out[key] = value
  }
  return out
}

export interface TaskWorktree {
  repoPath: string
  path: string
  branch: string
  baseRef: string
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 30000,
    // next-env.d.ts requires NODE_ENV on ProcessEnv; cast is safe, scrubEnv is an allowlist
    env: scrubEnv(process.env) as NodeJS.ProcessEnv,
  })
  return stdout.trim()
}

async function assertGitRepo(repoPath: string): Promise<void> {
  const inside = await git(repoPath, ["rev-parse", "--is-inside-work-tree"]).catch(() => "false")
  if (inside !== "true") throw new Error(`not a git repository: ${repoPath}`)
}

/**
 * Create <root>/<taskRef> on branch dock/task-<taskRef> from baseRef.
 * Idempotent: an existing clean worktree for the same task is reused.
 */
export async function createTaskWorktree(input: {
  repoPath: string
  taskRef: string
  baseRef?: string
}): Promise<TaskWorktree> {
  const repoPath = await realpath(resolve(input.repoPath)).catch(() => {
    throw new Error(`repo path does not exist: ${input.repoPath}`)
  })
  const baseRef = assertValidBaseRef(input.baseRef ?? "HEAD")
  const branch = taskBranchName(input.taskRef)
  const path = worktreePathFor(repoPath, input.taskRef)
  if (!isPathInside(worktreeRootFor(repoPath), path)) throw new Error("worktree path escapes root")
  await assertGitRepo(repoPath)
  await git(repoPath, ["rev-parse", "--verify", baseRef]).catch(() => {
    throw new Error(`unknown base ref: ${baseRef}`)
  })
  const existing = await git(repoPath, ["worktree", "list", "--porcelain"])
  if (!existing.includes(`worktree ${path}\n`) && !existing.startsWith(`worktree ${path}\n`)) {
    await git(repoPath, ["worktree", "add", path, "-b", branch, baseRef]).catch(async (err) => {
      // Branch exists but is not checked out anywhere: reuse it for this task.
      if (err instanceof Error && /already exists/.test(err.message)) {
        await git(repoPath, ["worktree", "add", path, branch])
        return ""
      }
      throw err
    })
  }
  // Post-create containment: the resolved worktree must stay under the resolved root
  // even if a path component was swapped for a symlink between checks.
  const resolvedRoot = await realpath(worktreeRootFor(repoPath))
  const resolvedPath = await realpath(path)
  if (!isPathInside(resolvedRoot, resolvedPath)) throw new Error("worktree path escapes root")
  return { repoPath, path: resolvedPath, branch, baseRef }
}

/** Remove the worktree; optionally delete the task branch (only ever dock/task-*). */
export async function removeTaskWorktree(input: {
  repoPath: string
  taskRef: string
  deleteBranch?: boolean
}): Promise<void> {
  const repoPath = await realpath(resolve(input.repoPath))
  const branch = taskBranchName(input.taskRef)
  const path = worktreePathFor(repoPath, input.taskRef)
  if (!isPathInside(worktreeRootFor(repoPath), path)) throw new Error("worktree path escapes root")
  await assertGitRepo(repoPath)
  await git(repoPath, ["worktree", "remove", "--force", path]).catch(() => "")
  if (input.deleteBranch) {
    if (!branch.startsWith(TASK_BRANCH_PREFIX)) throw new Error("refusing to delete a non-task branch")
    await git(repoPath, ["branch", "-D", branch]).catch(() => "")
  }
}

export interface TaskDiff {
  branch: string
  baseRef: string
  aheadBy: number
  stat: string
  nameStatus: string
  commits: string
}

/** Diff of a task branch against its base: what the owner reviews before merging. */
export async function diffForTaskBranch(input: {
  repoPath: string
  taskRef: string
  baseRef?: string
}): Promise<TaskDiff> {
  const repoPath = await realpath(resolve(input.repoPath))
  const branch = taskBranchName(input.taskRef)
  const baseRef = assertValidBaseRef(input.baseRef ?? "HEAD")
  await assertGitRepo(repoPath)
  const [stat, nameStatus, commits] = await Promise.all([
    git(repoPath, ["diff", "--stat", `${baseRef}...${branch}`]),
    git(repoPath, ["diff", "--name-status", `${baseRef}...${branch}`]),
    git(repoPath, ["log", "--oneline", "--no-decorate", `${baseRef}..${branch}`]),
  ])
  const aheadBy = commits ? commits.split("\n").length : 0
  return { branch, baseRef, aheadBy, stat, nameStatus, commits }
}

export interface WorktreeVerification {
  ok: boolean
  problems: string[]
  headBranch: string | null
  path: string
}

/**
 * Attestation for review: the worktree is where it should be, registered with
 * git, and checked out on the task branch. Detection, not confinement - it
 * catches an agent that switched branches or a path that was tampered with.
 */
export async function verifyTaskWorktree(input: {
  repoPath: string
  taskRef: string
}): Promise<WorktreeVerification> {
  const repoPath = await realpath(resolve(input.repoPath))
  const branch = taskBranchName(input.taskRef)
  const path = worktreePathFor(repoPath, input.taskRef)
  const problems: string[] = []
  let headBranch: string | null = null
  const resolvedPath = await realpath(path).catch(() => null)
  if (!resolvedPath) {
    problems.push("worktree directory is missing")
  } else {
    const resolvedRoot = await realpath(worktreeRootFor(repoPath)).catch(() => null)
    if (!resolvedRoot || !isPathInside(resolvedRoot, resolvedPath)) problems.push("worktree path escapes its root")
    headBranch = await git(resolvedPath, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => null)
    if (headBranch !== branch) problems.push(`worktree is on branch ${headBranch ?? "unknown"}, expected ${branch}`)
    const listed = await git(repoPath, ["worktree", "list", "--porcelain"]).catch(() => "")
    if (!listed.includes(`worktree ${resolvedPath}\n`)) problems.push("worktree is not registered with git")
  }
  return { ok: problems.length === 0, problems, headBranch, path }
}
