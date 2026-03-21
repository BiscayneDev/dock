'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface RecipeData { name: string; description: string; instructions: string; trigger_type: string; trigger_config: Record<string, unknown>; enabled: boolean; notify_on_run: boolean }

export default function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [form, setForm] = useState<RecipeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try { const res = await fetch(`/api/recipes/${id}`, { credentials: 'include' }); if (res.ok) { const d = await res.json(); setForm({ name: d.recipe.name, description: d.recipe.description ?? '', instructions: d.recipe.instructions, trigger_type: d.recipe.trigger_type, trigger_config: d.recipe.trigger_config, enabled: d.recipe.enabled, notify_on_run: d.recipe.notify_on_run }) } } catch {} finally { setLoading(false) }
  }, [id])
  useEffect(() => { load() }, [load])

  const u = (up: Partial<RecipeData>) => { if (form) setForm({ ...form, ...up }) }

  const save = async () => {
    if (!form) return; setSaving(true)
    try { const res = await fetch(`/api/recipes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form), credentials: 'include' }); if (res.ok) router.push(`/dashboard/recipes/${id}`) } catch {} finally { setSaving(false) }
  }

  if (loading || !form) return <HarborShell title="Edit Recipe" showBack backHref={`/dashboard/recipes/${id}`}><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>

  return (
    <HarborShell title="Edit Recipe" showBack backHref={`/dashboard/recipes/${id}`}>
      <div className="dock-card" style={{ marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div><span className="meta-text">Name</span><input type="text" value={form.name} onChange={(e) => u({ name: e.target.value })} className="dock-input" style={{ marginTop: '0.25rem' }} /></div>
          <div><span className="meta-text">Description</span><input type="text" value={form.description} onChange={(e) => u({ description: e.target.value })} className="dock-input" style={{ marginTop: '0.25rem' }} /></div>
          <div><span className="meta-text">Instructions</span><textarea value={form.instructions} onChange={(e) => u({ instructions: e.target.value })} rows={5} className="dock-input" style={{ marginTop: '0.25rem', resize: 'vertical' }} /></div>
          <div><span className="meta-text">Trigger</span><p style={{ fontSize: '0.9rem', marginTop: '0.15rem', fontFamily: "'Outfit', sans-serif", fontWeight: 500 }}>{form.trigger_type}</p></div>
        </div>
      </div>

      <div className="dock-card" style={{ marginTop: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <span style={{ fontSize: '0.9rem' }}>Enabled</span>
          <button className="dock-toggle" data-on={String(form.enabled)} onClick={() => u({ enabled: !form.enabled })}><span className="dock-toggle-knob" style={{ left: form.enabled ? undefined : '2px', right: form.enabled ? '2px' : undefined }} /></button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.9rem' }}>Notify after each run</span>
          <button className="dock-toggle" data-on={String(form.notify_on_run)} onClick={() => u({ notify_on_run: !form.notify_on_run })}><span className="dock-toggle-knob" style={{ left: form.notify_on_run ? undefined : '2px', right: form.notify_on_run ? '2px' : undefined }} /></button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
        <button onClick={() => router.back()} className="dock-btn-secondary" style={{ flex: 1 }}>Cancel</button>
        <button onClick={save} disabled={saving} className="dock-btn-primary" style={{ flex: 1 }}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </HarborShell>
  )
}
