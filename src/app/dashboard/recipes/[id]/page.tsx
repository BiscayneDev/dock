'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

interface Recipe {
  id: string; name: string; description: string | null; instructions: string
  trigger_type: string; trigger_config: Record<string, unknown>
  enabled: boolean; notify_on_run: boolean; last_run_at: string | null
  run_count: number; created_at: string
}

interface RecipeRun {
  id: string; status: string; triggered_at: string; completed_at: string | null
  output: string | null; error: string | null; duration_ms: number | null
}

const STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  success: { icon: 'ph-check-circle', color: 'text-emerald-500' },
  failed: { icon: 'ph-x-circle', color: 'text-red-500' },
  skipped: { icon: 'ph-skip-forward', color: 'text-slate-400' },
  running: { icon: 'ph-spinner', color: 'text-blue-500' },
  test: { icon: 'ph-flask', color: 'text-purple-500' },
}

export default function RecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [runs, setRuns] = useState<RecipeRun[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    try {
      const [recipeRes, runsRes] = await Promise.all([
        fetch(`/api/recipes/${id}`, { credentials: 'include' }),
        fetch(`/api/recipes/${id}/runs`, { credentials: 'include' }),
      ])
      if (recipeRes.ok) { setRecipe((await recipeRes.json()).recipe) }
      if (runsRes.ok) { setRuns((await runsRes.json()).runs ?? []) }
    } catch { /* Failed */ } finally { setLoading(false) }
  }, [id])

  useEffect(() => { loadData() }, [loadData])

  const runNow = async () => {
    await fetch(`/api/recipes/${id}/run`, { method: 'POST', credentials: 'include' })
    setTimeout(() => loadData(), 2000)
  }

  if (loading || !recipe) {
    return <HarborShell title="Recipe" showBack backHref="/dashboard/recipes"><div className="pt-20 text-center text-slate-400">{loading ? 'Loading...' : 'Not found.'}</div></HarborShell>
  }

  return (
    <HarborShell title={recipe.name} showBack backHref="/dashboard/recipes">
      <div className="flex gap-2 mt-2 mb-5">
        <button onClick={runNow} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500 hover:bg-white/70 transition-colors">
          <i className="ph-fill ph-play text-[14px] mr-1" />Run Now
        </button>
        <Link href={`/dashboard/recipes/${id}/edit`} className="flex-1 py-2.5 rounded-full bg-slate-800 text-center text-[13px] font-medium text-white hover:bg-slate-700 transition-colors">
          Edit
        </Link>
      </div>

      {/* Config card */}
      <div className="glass-card rounded-[20px] p-5 mb-5 space-y-3">
        <div className="flex gap-6">
          <div><p className="text-[11px] text-slate-400 uppercase tracking-wide">Trigger</p><p className="text-[14px] text-slate-700">{recipe.trigger_type}</p></div>
          <div><p className="text-[11px] text-slate-400 uppercase tracking-wide">Status</p><p className={`text-[14px] ${recipe.enabled ? 'text-emerald-500' : 'text-slate-400'}`}>{recipe.enabled ? 'Active' : 'Disabled'}</p></div>
          <div><p className="text-[11px] text-slate-400 uppercase tracking-wide">Runs</p><p className="text-[14px] text-slate-700">{recipe.run_count}</p></div>
        </div>
        <div>
          <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Instructions</p>
          <p className="text-[13px] text-slate-600">{recipe.instructions}</p>
        </div>
      </div>

      {/* Run history */}
      <h2 style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }} className="text-slate-700 mb-3">Run History</h2>
      {runs.length === 0 ? (
        <p className="text-[13px] text-slate-400">No runs yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => {
            const style = STATUS_STYLES[run.status] ?? { icon: 'ph-question', color: 'text-slate-400' }
            return (
              <div key={run.id} className="glass-card rounded-[16px]">
                <button
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  className="w-full flex items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <i className={`ph-fill ${style.icon} text-[18px] ${style.color}`} />
                    <span className="text-[13px] text-slate-600">{new Date(run.triggered_at).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] text-slate-400">
                    {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
                    <i className={`ph ph-caret-${expandedRun === run.id ? 'up' : 'down'} text-[14px]`} />
                  </div>
                </button>
                {expandedRun === run.id && (
                  <div className="border-t border-white/30 p-3">
                    {run.output && <pre className="text-[12px] text-slate-600 whitespace-pre-wrap" style={{ fontFamily: "'Inter', sans-serif" }}>{run.output}</pre>}
                    {run.error && <pre className="text-[12px] text-red-500 whitespace-pre-wrap" style={{ fontFamily: "'Inter', sans-serif" }}>{run.error}</pre>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </HarborShell>
  )
}
