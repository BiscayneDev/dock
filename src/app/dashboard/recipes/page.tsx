'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'

interface Recipe {
  id: string
  name: string
  trigger_type: string
  enabled: boolean
  last_run_at: string | null
  run_count: number
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: '🕐 Schedule',
  email_event: '📧 Email',
  github_event: '🐙 GitHub',
  notion_event: '📝 Notion',
  keyword: '💬 Keyword',
  manual: '▶️ Manual',
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
      // Failed to load
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

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Recipes</h1>
          <div className="flex gap-2">
            <Link
              href="/dashboard/recipes/gallery"
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              Gallery
            </Link>
            <Link
              href="/dashboard/recipes/new"
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 transition-colors"
            >
              + New Recipe
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="text-zinc-400">Loading...</p>
        ) : recipes.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="text-zinc-400">No recipes yet.</p>
            <p className="mt-2 text-sm text-zinc-500">
              Create one from the visual builder or browse the gallery for templates.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900">
                <tr className="text-left text-zinc-400">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Enabled</th>
                  <th className="px-4 py-3 font-medium">Last Run</th>
                  <th className="px-4 py-3 font-medium">Runs</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {recipes.map((recipe) => (
                  <tr key={recipe.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/recipes/${recipe.id}`}
                        className="text-zinc-100 hover:text-cyan-400 transition-colors"
                      >
                        {recipe.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {TRIGGER_LABELS[recipe.trigger_type] ?? recipe.trigger_type}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRecipe(recipe.id, !recipe.enabled)}
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          recipe.enabled
                            ? 'bg-emerald-900/50 text-emerald-400'
                            : 'bg-zinc-800 text-zinc-500'
                        }`}
                      >
                        {recipe.enabled ? 'On' : 'Off'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {recipe.last_run_at
                        ? new Date(recipe.last_run_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{recipe.run_count}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Link
                          href={`/dashboard/recipes/${recipe.id}/edit`}
                          className="text-zinc-400 hover:text-cyan-400 transition-colors"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => deleteRecipe(recipe.id)}
                          className="text-zinc-400 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}
