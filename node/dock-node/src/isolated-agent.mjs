import { sharedKnowledgeContext, specialistBrief } from './shared-knowledge.mjs'
import { loadRegisteredRepos } from './isolation.mjs'
import { runConfinedCoding } from './confined-coding.mjs'

export async function runIsolatedAgentTask({ repoKey, taskRef, baseRef, brief, infer, env = process.env, registeredRepos }) {
  if (env.DOCK_ISOLATED_RUNTIME !== 'on') throw new Error('experimental isolated runtime disabled')
  const repos = registeredRepos ?? await loadRegisteredRepos()
  // Alias is a configured repository basename, never an arbitrary remote path.
  const { basename } = await import('node:path')
  const matches = repos.filter((repo) => basename(repo) === repoKey)
  if (matches.length !== 1) throw new Error('repository alias is missing or ambiguous on this host')
  if (typeof infer !== 'function') throw new Error('Dock metered inference callback required')
  const shared = env.DOCK_SHARED_KNOWLEDGE_DIR ? await sharedKnowledgeContext(env.DOCK_SHARED_KNOWLEDGE_DIR, brief) : null
  return runConfinedCoding({ repo: matches[0], taskRef, baseRef, brief: specialistBrief('builder', brief, shared), infer, env })
}
