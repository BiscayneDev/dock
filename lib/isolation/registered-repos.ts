/**
 * Registered repos: the allowlist of repositories tasks may run in.
 *
 * Activation with isolation takes a repoPath over HTTP. Owner sign-in or the
 * agent token authenticates the CALLER, but neither is the owner pointing at
 * this particular repository - so an arbitrary path is not accepted. The owner
 * registers repos explicitly (POST /api/repos, owner session only; the agent
 * token cannot register), and isolated activation refuses anything not on the
 * list. Paths are compared by real destination (realpath), so a symlinked path
 * only matches when it truly resolves to a registered repo.
 *
 * The list lives in ~/.config/dock/private/registered-repos.json via the
 * private-store guarantees: outside the application tree, 0700 directory,
 * 0600 file, no symlinks, owned by the current uid.
 */
import path from "node:path"
import { lstat, realpath } from "node:fs/promises"
import { readPrivateStore, writePrivateStore } from "../private-store.ts"
import { dockPrivateDir } from "../private-dir.ts"

async function defaultFile(): Promise<string> {
  return path.join(await dockPrivateDir(), "registered-repos.json")
}

export async function listRegisteredRepos(file?: string): Promise<string[]> {
  const data = await readPrivateStore(file ?? (await defaultFile()))
  if (!Array.isArray(data)) return []
  return data.filter((entry): entry is string => typeof entry === "string")
}

/**
 * Register a repo (owner action). Resolves to its real path and requires a
 * .git entry, so a directory that is not a repo cannot be registered.
 */
export async function registerRepo(repoPath: string, file?: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path.resolve(repoPath))
  } catch {
    throw new Error(`repo path does not exist: ${repoPath}`)
  }
  await lstat(path.join(resolved, ".git")).catch(() => {
    throw new Error(`not a git repository: ${resolved}`)
  })
  const target = file ?? (await defaultFile())
  const list = await listRegisteredRepos(target)
  if (!list.includes(resolved)) {
    list.push(resolved)
    await writePrivateStore(target, list)
  }
  return resolved
}

/**
 * Resolve and authorize a repoPath from an activation request. Returns the
 * real registered path; throws when the path is missing or not registered.
 */
export async function assertRepoRegistered(repoPath: string, file?: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path.resolve(repoPath))
  } catch {
    throw new Error(`repo path does not exist: ${repoPath}`)
  }
  const list = await listRegisteredRepos(file)
  if (!list.includes(resolved)) {
    throw new Error(`repo is not registered for isolated runs: ${resolved}`)
  }
  return resolved
}
