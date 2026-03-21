'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

interface Recipe {
  id: string
  name: string
  trigger_type: string
  enabled: boolean
  last_run_at: string | null
  run_count: number
}

const TRIGGER_ICONS: Record<string, string> = {
  schedule: 'ph-clock',
  email_event: 'ph-envelope',
  github_event: 'ph-github-logo',
  notion_event: 'ph-notepad',
  keyword: 'ph-chat-teardrop-text',
  manual: 'ph-play',
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
    } catch { /* Failed */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadRecipes() }, [loadRecipes])

  const toggleRecipe = async (id: string, enabled: boolean) => {
    await fetch(`/api/recipes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }), credentials: 'include',
    })
    setRecipes(recipes.map((r) => r.id === id ? { ...r, enabled } : r))
  }

  const deleteRecipe = async (id: string) => {
    if (!confirm('Delete this recipe?')) return
    await fetch(`/api/recipes/${id}`, { method: 'DELETE', credentials: 'include' })
    setRecipes(recipes.filter((r) => r.id !== id))
  }

  const activeCount = recipes.filter((r) => r.enabled).length

  return (
    <HarborShell title="Recipes" showBack>
      {/* Actions */}
      <div className="flex gap-2 mt-2 mb-5">
        <Link href="/dashboard/recipes/gallery" className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-center text-[13px] font-medium text-slate-500 hover:bg-white/70 transition-colors">
          Gallery
        </Link>
        <Link href="/dashboard/recipes/new" className="flex-1 py-2.5 rounded-full bg-slate-800 text-center text-[13px] font-medium text-white hover:bg-slate-700 transition-colors">
          + New Recipe
        </Link>
      </div>

      {recipes.length > 0 && (
        <p className="text-[13px] text-slate-400 mb-3">{activeCount} active · {recipes.reduce((s, r) => s + r.run_count, 0)} total runs</p>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card rounded-[20px] h-20 animate-pulse" />
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <div className="glass-card rounded-[24px] p-10 text-center">
          <i className="ph-fill ph-circuitry text-[40px] text-slate-400 mb-3" />
          <p className="text-[16px] text-slate-600 font-medium">No recipes yet</p>
          <p className="text-[13px] text-slate-400 mt-1 max-w-xs mx-auto">
            Recipes are automations that run on schedule or when triggered.
          </p>
          <div className="flex justify-center gap-2 mt-5">
            <Link href="/dashboard/recipes/gallery" className="px-4 py-2 rounded-full bg-slate-800 text-white text-[13px] font-medium">
              Browse Gallery
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {recipes.map((recipe) => {
            const icon = TRIGGER_ICONS[recipe.trigger_type] ?? 'ph-gear'
            return (
              <div key={recipe.id} className="glass-card rounded-[20px] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-white/50 flex items-center justify-center flex-shrink-0">
                      <i className={`ph-fill ${icon} text-[18px] text-slate-600`} />
                    </div>
                    <div className="min-w-0">
                      <Link href={`/dashboard/recipes/${recipe.id}`} className="font-medium text-slate-700 text-[15px] hover:text-blue-600 transition-colors truncate block">
                        {recipe.name}
                      </Link>
                      <p className="text-[12px] text-slate-400">
                        {recipe.run_count} run{recipe.run_count !== 1 ? 's' : ''}
                        {recipe.last_run_at && ` · Last: ${new Date(recipe.last_run_at).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button
                      onClick={() => toggleRecipe(recipe.id, !recipe.enabled)}
                      className={`relative w-11 h-6 rounded-full transition-colors ${recipe.enabled ? 'bg-emerald-400' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${recipe.enabled ? 'translate-x-5' : ''}`} />
                    </button>
                    <button onClick={() => deleteRecipe(recipe.id)} className="text-[12px] text-slate-400 hover:text-red-500 transition-colors">
                      <i className="ph ph-trash text-[16px]" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </HarborShell>
  )
}
