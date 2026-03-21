'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface RecipeData {
  name: string; description: string; instructions: string
  trigger_type: string; trigger_config: Record<string, unknown>
  enabled: boolean; notify_on_run: boolean
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
          name: data.recipe.name, description: data.recipe.description ?? '',
          instructions: data.recipe.instructions, trigger_type: data.recipe.trigger_type,
          trigger_config: data.recipe.trigger_config, enabled: data.recipe.enabled,
          notify_on_run: data.recipe.notify_on_run,
        })
      }
    } catch { /* Failed */ } finally { setLoading(false) }
  }, [id])

  useEffect(() => { loadRecipe() }, [loadRecipe])

  const updateForm = (updates: Partial<RecipeData>) => { if (form) setForm({ ...form, ...updates }) }

  const saveRecipe = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form), credentials: 'include',
      })
      if (res.ok) router.push(`/dashboard/recipes/${id}`)
    } catch { /* Failed */ } finally { setSaving(false) }
  }

  if (loading || !form) {
    return <HarborShell title="Edit Recipe" showBack backHref={`/dashboard/recipes/${id}`}><div className="pt-20 text-center text-slate-400">Loading...</div></HarborShell>
  }

  return (
    <HarborShell title="Edit Recipe" showBack backHref={`/dashboard/recipes/${id}`}>
      <div className="space-y-4 mt-4">
        <div className="glass-card rounded-[20px] p-5 space-y-4">
          <div>
            <label className="text-[12px] text-slate-400 uppercase tracking-wide">Name</label>
            <input type="text" value={form.name} onChange={(e) => updateForm({ name: e.target.value })}
              className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" />
          </div>
          <div>
            <label className="text-[12px] text-slate-400 uppercase tracking-wide">Description</label>
            <input type="text" value={form.description} onChange={(e) => updateForm({ description: e.target.value })}
              className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1" />
          </div>
          <div>
            <label className="text-[12px] text-slate-400 uppercase tracking-wide">Instructions</label>
            <textarea value={form.instructions} onChange={(e) => updateForm({ instructions: e.target.value })} rows={5}
              className="glass-input w-full rounded-xl px-3 py-2.5 text-[14px] text-slate-700 mt-1 resize-y" />
          </div>
          <div>
            <label className="text-[12px] text-slate-400 uppercase tracking-wide">Trigger Type</label>
            <p className="text-[14px] text-slate-600 mt-1">{form.trigger_type}</p>
          </div>
        </div>

        <div className="glass-card rounded-[20px] p-5 space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[14px] text-slate-600">Enabled</span>
            <button onClick={() => updateForm({ enabled: !form.enabled })}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.enabled ? 'bg-emerald-400' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.enabled ? 'translate-x-5' : ''}`} />
            </button>
          </label>
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[14px] text-slate-600">Notify after each run</span>
            <button onClick={() => updateForm({ notify_on_run: !form.notify_on_run })}
              className={`relative w-11 h-6 rounded-full transition-colors ${form.notify_on_run ? 'bg-emerald-400' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.notify_on_run ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={() => router.back()} className="flex-1 py-2.5 rounded-full bg-white/50 border border-white/70 text-[13px] font-medium text-slate-500">
            Cancel
          </button>
          <button onClick={saveRecipe} disabled={saving}
            className="flex-1 py-2.5 rounded-full bg-slate-800 text-white text-[13px] font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </HarborShell>
  )
}
