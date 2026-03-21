'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Template { slug: string; name: string; description: string; category: string; requiredIntegrations: string[]; triggerType: string; previewOutput: string; icon: string }

export default function GalleryPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [previewSlug, setPreviewSlug] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const res = await fetch('/api/recipe-templates'); if (res.ok) setTemplates((await res.json()).templates ?? []) } catch {} finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const install = async (slug: string) => {
    setInstalling(slug)
    try { const res = await fetch(`/api/recipe-templates/${slug}/install`, { method: 'POST', credentials: 'include' }); if (res.ok) { const d = await res.json(); router.push(d.needsConfig ? d.editUrl : `/dashboard/recipes/${d.recipe.id}`) } } catch {} finally { setInstalling(null) }
  }

  const filtered = activeCategory ? templates.filter((t) => t.category === activeCategory) : templates
  const categories = [...new Set(templates.map((t) => t.category))]

  return (
    <HarborShell title="Recipe Gallery" showBack backHref="/dashboard/recipes">
      <p style={{ opacity: 0.5, fontSize: '0.9rem', marginBottom: '1rem' }}>Pre-built automations. Install in one tap.</p>

      {/* Category pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.25rem' }}>
        <button onClick={() => setActiveCategory(null)} className={activeCategory === null ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>All</button>
        {categories.map((cat) => (
          <button key={cat} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)} className={activeCategory === cat ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>{cat}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>{[1, 2, 3, 4].map((i) => <div key={i} className="dock-card" style={{ height: '10rem', opacity: 0.3 }} />)}</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {filtered.map((t) => (
            <div key={t.slug} className="dock-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '1.5rem' }}>{t.icon}</span>
                <span className="meta-text">{t.category}</span>
              </div>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2, marginTop: '0.5rem' }}>{t.name}</p>
              <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '0.25rem', flex: 1 }}>{t.description}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
                {t.requiredIntegrations.map((i) => <span key={i} className="meta-text" style={{ border: '1px solid var(--ink)', borderRadius: '1rem', padding: '0.1rem 0.4rem', opacity: 0.5 }}>{i}</span>)}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem' }}>
                <button onClick={() => install(t.slug)} disabled={installing === t.slug} className="dock-btn-primary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem' }}>{installing === t.slug ? '...' : 'Add'}</button>
                <button onClick={() => setPreviewSlug(previewSlug === t.slug ? null : t.slug)} className="dock-btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                </button>
              </div>
              {previewSlug === t.slug && (
                <div style={{ marginTop: '0.5rem', borderTop: '1.5px solid var(--ink)', paddingTop: '0.5rem' }}>
                  <p className="meta-text" style={{ marginBottom: '0.25rem' }}>Preview</p>
                  <pre style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap', fontFamily: "'Lora', serif", opacity: 0.7 }}>{t.previewOutput}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: '2rem', textAlign: 'center' }}>
        <p style={{ opacity: 0.4, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Looking for something else?</p>
        <button onClick={() => router.push('/dashboard/recipes/new')} className="dock-btn-secondary">Create your own</button>
      </div>
    </HarborShell>
  )
}
