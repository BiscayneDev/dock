export interface IsolatedTask { repoKey: string; taskRef: string; baseRef: string; brief: string }
export function parseIsolatedTask(raw: unknown): IsolatedTask | null {
  if (!raw || typeof raw !== 'object') return null
  const x = raw as Record<string, unknown>
  if (typeof x.repoKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(x.repoKey)) return null
  if (typeof x.taskRef !== 'string' || !/^task-[a-z0-9][a-z0-9-]{0,62}$/.test(x.taskRef)) return null
  if (typeof x.baseRef !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9/._-]{0,100}$/.test(x.baseRef) || x.baseRef.includes('..')) return null
  if (typeof x.brief !== 'string' || !x.brief.trim() || x.brief.length > 8000) return null
  return { repoKey: x.repoKey, taskRef: x.taskRef, baseRef: x.baseRef, brief: x.brief }
}
