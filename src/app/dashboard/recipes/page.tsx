'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'

interface Recipe {
  id: string
  name: string
  description: string | null
  trigger_type: string
  enabled: boolean
  last_run_at: string | null
  run_count: number
}

const TRIGGER_META: Record<string, { icon: string; label: string }> = {
  schedule: { icon: '🕐', label: 'Schedule' },
  email_event: { icon: '📧', label: 'Email' },
  github_event: { icon: '🐙', label: 'GitHub' },
  notion_event: { icon: '📝', label: 'Notion' },
  keyword: { icon: '💬', label: 'Keyword' },
  manual: { icon: '▶️', label: 'Manual' },
}

export default function RecipeListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)

  const loadRecipes = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setRecipes(data.recipes ?? [])
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRecipes()
  }, [loadRecipes])

  const toggleRecipe = async (id: string, enabled: boolean) => {
    await fetch(`/api/recipes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
      credentials: 'include',
    })
    setRecipes(recipes.map((r) => r.id === id ? { ...r, enabled } : r))
  }

  const deleteRecipe = async (id: string) => {
    if (!confirm('Delete this recipe?')) return
    await fetch(`/api/recipes/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    setRecipes(recipes.filter((r) => r.id !== id))
  }

  const activeCount = recipes.filter((r) => r.enabled).length
  const totalRuns = recipes.reduce((sum, r) => sum + r.run_count, 0)

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Recipes</h1>
            {recipes.length > 0 && (
              <p className="mt-1 text-sm text-zinc-500">
                {activeCount} active · {totalRuns} total runs
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/recipes/gallery"
              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              Gallery
            </Link>
            <Link
              href="/dashboard/recipes/new"
              className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              + New Recipe
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-2xl border border-zinc-800 bg-zinc-900/30 animate-pulse" />
            ))}
          </div>
        ) : recipes.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-12 text-center">
            <p className="text-4xl mb-3">🤖</p>
            <p className="text-lg text-zinc-300">No recipes yet</p>
            <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
              Recipes are automations that run on schedule or when triggered.
              Browse the gallery for templates or create your own.
            </p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link
                href="/dashboard/recipes/gallery"
                className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
              >
                Browse Gallery
              </Link>
              <Link
                href="/dashboard/recipes/new"
                className="rounded-xl border border-zinc-700 px-5 py-2.5 text-sm text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                Create from scratch
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {recipes.map((recipe) => {
              const trigger = TRIGGER_META[recipe.trigger_type]
              return (
                <div
                  key={recipe.id}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4 hover:border-zinc-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xl flex-shrink-0">{trigger?.icon ?? '🔧'}</span>
                      <div className="min-w-0">
                        <Link
                          href={`/dashboard/recipes/${recipe.id}`}
                          className="font-medium text-zinc-100 hover:text-cyan-400 transition-colors truncate block"
                        >
                          {recipe.name}
                        </Link>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-zinc-500">{trigger?.label ?? recipe.trigger_type}</span>
                          <span className="text-zinc-700">·</span>
                          <span className="text-xs text-zinc-500">
                            {recipe.run_count} run{recipe.run_count !== 1 ? 's' : ''}
                          </span>
                          {recipe.last_run_at && (
                            <>
                              <span className="text-zinc-700">·</span>
                              <span className="text-xs text-zinc-500">
                                Last: {new Date(recipe.last_run_at).toLocaleDateString()}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                      <button
                        onClick={() => toggleRecipe(recipe.id, !recipe.enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          recipe.enabled ? 'bg-cyan-600' : 'bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                            recipe.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                      <Link
                        href={`/dashboard/recipes/${recipe.id}/edit`}
                        className="text-xs text-zinc-400 hover:text-cyan-400 transition-colors"
                      >
                        Edit
                      </Link>
                      <button
                        onClick={() => deleteRecipe(recipe.id)}
                        className="text-xs text-zinc-400 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
