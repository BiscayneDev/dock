'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/NavBar'

interface RecipeData {
  name: string
  description: string
  instructions: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  enabled: boolean
  notify_on_run: boolean
}

export default function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [form, setForm] = useState<RecipeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const loadRecipe = useCallback(async () => {
    try {
      const res = await fetch(`/api/recipes/${id}`, { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setForm({
          name: data.recipe.name,
          description: data.recipe.description ?? '',
          instructions: data.recipe.instructions,
          trigger_type: data.recipe.trigger_type,
          trigger_config: data.recipe.trigger_config,
          enabled: data.recipe.enabled,
          notify_on_run: data.recipe.notify_on_run,
        })
      }
    } catch {
      // Failed
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadRecipe()
  }, [loadRecipe])

  const updateForm = (updates: Partial<RecipeData>) => {
    if (!form) return
    setForm({ ...form, ...updates })
  }

  const updateConfig = (key: string, value: unknown) => {
    if (!form) return
    setForm({
      ...form,
      trigger_config: { ...form.trigger_config, [key]: value },
    })
  }

  const saveRecipe = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
        credentials: 'include',
      })
      if (res.ok) {
        router.push(`/dashboard/recipes/${id}`)
      }
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) {
    return (
      <>
        <NavBar showDashboard />
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-zinc-400">Loading...</p>
        </main>
      </>
    )
  }

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-100 mb-6">Edit Recipe</h1>

        <div className="space-y-6">
          {/* Name */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateForm({ name: e.target.value })}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Description</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => updateForm({ description: e.target.value })}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
            />
          </div>

          {/* Trigger type (read-only) */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Trigger type</label>
            <p className="text-zinc-200">{form.trigger_type}</p>
          </div>

          {/* Trigger config */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Trigger configuration</label>
            {form.trigger_type === 'schedule' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={(form.trigger_config.cron as string) ?? ''}
                  onChange={(e) => updateConfig('cron', e.target.value)}
                  placeholder="0 9 * * 1-5"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">Standard 5-part cron expression</p>
              </div>
            )}
            {form.trigger_type === 'keyword' && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={(form.trigger_config.phrase as string) ?? ''}
                  onChange={(e) => updateConfig('phrase', e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
                />
              </div>
            )}
            {!['schedule', 'keyword', 'manual'].includes(form.trigger_type) && (
              <textarea
                value={JSON.stringify(form.trigger_config, null, 2)}
                onChange={(e) => {
                  try {
                    updateForm({ trigger_config: JSON.parse(e.target.value) })
                  } catch {
                    // Invalid JSON — ignore
                  }
                }}
                rows={4}
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 font-mono text-sm"
              />
            )}
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-sm text-zinc-400 mb-1">Instructions</label>
            <textarea
              value={form.instructions}
              onChange={(e) => updateForm({ instructions: e.target.value })}
              rows={6}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100 resize-y"
            />
          </div>

          {/* Settings */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => updateForm({ enabled: e.target.checked })}
                className="rounded border-zinc-600"
              />
              <span className="text-zinc-300">Enabled</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.notify_on_run}
                onChange={(e) => updateForm({ notify_on_run: e.target.checked })}
                className="rounded border-zinc-600"
              />
              <span className="text-zinc-300">Notify after each run</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => router.back()}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300"
            >
              Cancel
            </button>
            <button
              onClick={saveRecipe}
              disabled={saving}
              className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </main>
    </>
  )
}
