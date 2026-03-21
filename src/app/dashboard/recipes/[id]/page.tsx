'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'

interface Recipe {
  id: string
  name: string
  description: string | null
  instructions: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  enabled: boolean
  notify_on_run: boolean
  last_run_at: string | null
  run_count: number
  created_at: string
}

interface RecipeRun {
  id: string
  status: string
  triggered_at: string
  completed_at: string | null
  output: string | null
  error: string | null
  duration_ms: number | null
}

const STATUS_ICONS: Record<string, string> = {
  success: '✅',
  failed: '❌',
  skipped: '⏭️',
  running: '⏳',
  test: '🧪',
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

      if (recipeRes.ok) {
        const data = await recipeRes.json()
        setRecipe(data.recipe)
      }
      if (runsRes.ok) {
        const data = await runsRes.json()
        setRuns(data.runs ?? [])
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadData()
  }, [loadData])

  const runNow = async () => {
    await fetch(`/api/recipes/${id}/run`, {
      method: 'POST',
      credentials: 'include',
    })
    // Reload after a brief delay
    setTimeout(() => loadData(), 2000)
  }

  if (loading) {
    return (
      <>
        <NavBar showDashboard />
        <main className="mx-auto max-w-3xl px-4 py-20 text-center">
          <p className="text-zinc-400">Loading...</p>
        </main>
      </>
    )
  }

  if (!recipe) {
    return (
      <>
        <NavBar showDashboard />
        <main className="mx-auto max-w-3xl px-4 py-20 text-center">
          <p className="text-zinc-400">Recipe not found.</p>
        </main>
      </>
    )
  }

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{recipe.name}</h1>
            {recipe.description && (
              <p className="mt-1 text-zinc-400">{recipe.description}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={runNow}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
            >
              ▶️ Run Now
            </button>
            <Link
              href={`/dashboard/recipes/${id}/edit`}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Edit
            </Link>
          </div>
        </div>

        {/* Config */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-3 mb-8">
          <div className="flex gap-8">
            <div>
              <p className="text-xs text-zinc-500">Trigger</p>
              <p className="text-zinc-200">{recipe.trigger_type}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Status</p>
              <p className={recipe.enabled ? 'text-emerald-400' : 'text-zinc-500'}>
                {recipe.enabled ? 'Active' : 'Disabled'}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">Total runs</p>
              <p className="text-zinc-200">{recipe.run_count}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Instructions</p>
            <p className="text-sm text-zinc-300 mt-1">{recipe.instructions}</p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Config</p>
            <pre className="text-xs text-zinc-400 mt-1">
              {JSON.stringify(recipe.trigger_config, null, 2)}
            </pre>
          </div>
        </div>

        {/* Run history */}
        <h2 className="text-lg font-semibold text-zinc-200 mb-3">Run History</h2>
        {runs.length === 0 ? (
          <p className="text-zinc-500 text-sm">No runs yet.</p>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/50"
              >
                <button
                  onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                  className="w-full flex items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span>{STATUS_ICONS[run.status] ?? '❓'}</span>
                    <span className="text-sm text-zinc-300">
                      {new Date(run.triggered_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-zinc-500">
                    {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
                    <span>{expandedRun === run.id ? '▲' : '▼'}</span>
                  </div>
                </button>
                {expandedRun === run.id && (
                  <div className="border-t border-zinc-800 p-3">
                    {run.output && (
                      <pre className="text-sm text-zinc-300 whitespace-pre-wrap">{run.output}</pre>
                    )}
                    {run.error && (
                      <pre className="text-sm text-red-400 whitespace-pre-wrap">{run.error}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
