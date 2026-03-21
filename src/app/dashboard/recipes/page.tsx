'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

interface Recipe { id: string; name: string; trigger_type: string; enabled: boolean; last_run_at: string | null; run_count: number }

const TRIGGER_ICONS: Record<string, string> = {
  schedule: 'M12 2v10l4.5 4.5M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  email_event: 'M4 7L10.2 11.65C11.27 12.45 12.73 12.45 13.8 11.65L20 7M3 5h18v14H3z',
  github_event: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4',
  keyword: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  manual: 'M5 3l14 9-14 9V3z',
}

export default function RecipeListPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try { const res = await fetch('/api/recipes', { credentials: 'include' }); if (res.ok) { setRecipes((await res.json()).recipes ?? []) } } catch {} finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = async (id: string, enabled: boolean) => {
    await fetch(`/api/recipes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }), credentials: 'include' })
    setRecipes(recipes.map((r) => r.id === id ? { ...r, enabled } : r))
  }
  const remove = async (id: string) => {
    if (!confirm('Delete this recipe?')) return
    await fetch(`/api/recipes/${id}`, { method: 'DELETE', credentials: 'include' })
    setRecipes(recipes.filter((r) => r.id !== id))
  }

  const active = recipes.filter((r) => r.enabled).length

  return (
    <HarborShell title="Recipes" showBack>
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <Link href="/dashboard/recipes/gallery" className="dock-btn-secondary" style={{ flex: 1 }}>Gallery</Link>
        <Link href="/dashboard/recipes/new" className="dock-btn-primary" style={{ flex: 1 }}>+ New Recipe</Link>
      </div>

      {recipes.length > 0 && <p className="meta-text" style={{ marginBottom: '0.75rem' }}>{active} active · {recipes.reduce((s, r) => s + r.run_count, 0)} runs</p>}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{[1, 2, 3].map((i) => <div key={i} className="dock-card" style={{ height: '4.5rem', opacity: 0.3 }} />)}</div>
      ) : recipes.length === 0 ? (
        <div className="dock-card" style={{ padding: '3rem', alignItems: 'center', textAlign: 'center' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1" strokeLinecap="round" style={{ opacity: 0.3, marginBottom: '1rem' }}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>No recipes yet</p>
          <p style={{ fontSize: '0.85rem', opacity: 0.5, marginTop: '0.25rem' }}>Browse the gallery or create one from scratch.</p>
          <Link href="/dashboard/recipes/gallery" className="dock-btn-primary" style={{ marginTop: '1rem' }}>Browse Gallery</Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {recipes.map((r) => (
            <div key={r.id} className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                <div className="badge-num">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={TRIGGER_ICONS[r.trigger_type] ?? TRIGGER_ICONS.manual} /></svg>
                </div>
                <div style={{ minWidth: 0 }}>
                  <Link href={`/dashboard/recipes/${r.id}`} style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none', color: 'var(--ink)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</Link>
                  <p style={{ fontSize: '0.7rem', opacity: 0.5 }}>{r.run_count} runs{r.last_run_at ? ` · ${new Date(r.last_run_at).toLocaleDateString()}` : ''}</p>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                <button className="dock-toggle" data-on={String(r.enabled)} onClick={() => toggle(r.id, !r.enabled)}>
                  <span className="dock-toggle-knob" style={{ left: r.enabled ? undefined : '2px', right: r.enabled ? '2px' : undefined }} />
                </button>
                <button onClick={() => remove(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </HarborShell>
  )
}
