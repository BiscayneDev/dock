'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Template { slug: string; name: string; description: string; category: string; requiredIntegrations: string[]; triggerType: string; previewOutput: string; icon: string }
interface PublicRecipe { id: string; name: string; description: string | null; instructions: string; trigger_type: string; category: string | null; fee_amount: number; fee_required: boolean; run_count: number; fork_count: number; creator: { name: string; username: string | null }; created_at: string }
interface MyRecipe { id: string; name: string; trigger_type: string; enabled: boolean; run_count: number; last_run_at: string | null; is_public: boolean; fee_amount: number; fee_required: boolean }

type Tab = 'mine' | 'marketplace' | 'templates'
type Pricing = 'all' | 'free' | 'paid'

const TRIGGER_ICONS: Record<string, string> = {
  schedule: '🕐', email_event: '📧', github_event: '🐙', notion_event: '📝', keyword: '💬', manual: '▶️',
}

export default function GalleryPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('mine')
  const [templates, setTemplates] = useState<Template[]>([])
  const [recipes, setRecipes] = useState<PublicRecipe[]>([])
  const [myRecipes, setMyRecipes] = useState<MyRecipe[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [pricing, setPricing] = useState<Pricing>('all')
  const [installing, setInstalling] = useState<string | null>(null)
  const [forking, setForking] = useState<string | null>(null)
  const [previewSlug, setPreviewSlug] = useState<string | null>(null)

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/recipe-templates')
      if (res.ok) setTemplates((await res.json()).templates ?? [])
    } catch {}
  }, [])

  const loadRecipes = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (search) params.set('search', search)
      if (activeCategory) params.set('category', activeCategory)
      if (pricing !== 'all') params.set('pricing', pricing)
      const res = await fetch(`/api/recipes/public?${params}`)
      if (res.ok) setRecipes((await res.json()).recipes ?? [])
    } catch {}
  }, [search, activeCategory, pricing])

  const loadMyRecipes = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (res.ok) setMyRecipes((await res.json()).recipes ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadTemplates(), loadRecipes(), loadMyRecipes()]).finally(() => setLoading(false))
  }, [loadTemplates, loadRecipes, loadMyRecipes])

  const installTemplate = async (slug: string) => {
    setInstalling(slug)
    try {
      const res = await fetch(`/api/recipe-templates/${slug}/install`, { method: 'POST', credentials: 'include' })
      if (res.ok) { const d = await res.json(); router.push(d.needsConfig ? d.editUrl : `/dashboard/recipes/${d.recipe.id}`) }
    } catch {} finally { setInstalling(null) }
  }

  const forkRecipe = async (id: string) => {
    setForking(id)
    try {
      const res = await fetch(`/api/recipes/${id}/fork`, { method: 'POST', credentials: 'include' })
      if (res.ok) { const d = await res.json(); router.push(d.editUrl ?? `/dashboard/recipes/${d.recipe.id}`) }
    } catch {} finally { setForking(null) }
  }

  const filteredTemplates = activeCategory ? templates.filter((t) => t.category === activeCategory) : templates
  const allCategories = [...new Set([...templates.map((t) => t.category), ...recipes.map((r) => r.category).filter(Boolean)])]

  return (
    <HarborShell title="Recipe Marketplace" showBack backHref="/dashboard/recipes">
      <p style={{ opacity: 0.5, fontSize: '0.9rem', marginBottom: '1rem' }}>Discover automations from the community or start from a template.</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('mine')} className={tab === 'mine' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          My Recipes {myRecipes.length > 0 && <span style={{ opacity: 0.5, marginLeft: '0.25rem' }}>({myRecipes.length})</span>}
        </button>
        <button onClick={() => setTab('marketplace')} className={tab === 'marketplace' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          Marketplace
        </button>
        <button onClick={() => setTab('templates')} className={tab === 'templates' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          Templates
        </button>
      </div>

      {/* Search + Filters */}
      <input
        type="text"
        placeholder="Search recipes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="dock-input"
        style={{ marginBottom: '0.75rem' }}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
        <button onClick={() => setActiveCategory(null)} className={activeCategory === null ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>All</button>
        {allCategories.map((cat) => (
          <button key={cat} onClick={() => setActiveCategory(activeCategory === cat ? null : cat)} className={activeCategory === cat ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}>{cat}</button>
        ))}
      </div>

      {tab === 'marketplace' && (
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.25rem' }}>
          {(['all', 'free', 'paid'] as Pricing[]).map((p) => (
            <button key={p} onClick={() => setPricing(p)} style={{ padding: '0.2rem 0.6rem', fontSize: '0.7rem', borderRadius: '1rem', border: '1.5px solid var(--ink)', background: pricing === p ? 'var(--ink)' : 'var(--cream)', color: pricing === p ? 'var(--cream)' : 'var(--ink)', fontFamily: "'Outfit', sans-serif", fontWeight: 700, cursor: 'pointer' }}>
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {[1, 2, 3, 4].map((i) => <div key={i} className="dock-card" style={{ height: '10rem', opacity: 0.3 }} />)}
        </div>
      ) : tab === 'mine' ? (
        /* MY RECIPES */
        myRecipes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>No recipes yet</p>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', marginBottom: '1rem' }}>Create your first recipe or install one from templates.</p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={() => router.push('/dashboard/recipes/workspace')} className="dock-btn-primary">Open Workspace</button>
              <button onClick={() => setTab('templates')} className="dock-btn-secondary">Browse Templates</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {myRecipes.map((r) => (
              <button key={r.id} onClick={() => router.push(`/dashboard/recipes/${r.id}`)} className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{TRIGGER_ICONS[r.trigger_type] ?? '⚡'}</span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.15rem' }}>
                      <span style={{ fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: r.enabled ? 'var(--mesh-mint)' : 'var(--ink)', opacity: r.enabled ? 1 : 0.4 }}>{r.enabled ? 'Active' : 'Disabled'}</span>
                      <span style={{ fontSize: '0.65rem', opacity: 0.4 }}>{r.run_count} runs</span>
                      {r.is_public && <span style={{ fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, border: '1px solid var(--mesh-cyan)', borderRadius: '1rem', padding: '0 0.35rem', color: 'var(--mesh-cyan)' }}>Public</span>}
                      {r.fee_required && r.fee_amount > 0 && <span style={{ fontSize: '0.6rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, border: '1px solid var(--mesh-cyan)', borderRadius: '1rem', padding: '0 0.35rem', color: 'var(--mesh-cyan)' }}>${r.fee_amount}</span>}
                    </div>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.3, flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>
              </button>
            ))}
          </div>
        )
      ) : tab === 'marketplace' ? (
        /* MARKETPLACE — public user recipes */
        recipes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>No recipes yet</p>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', marginBottom: '1rem' }}>Be the first to publish a recipe to the marketplace.</p>
            <button onClick={() => router.push('/dashboard/recipes/new')} className="dock-btn-primary">Create a recipe</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
            {recipes.map((r) => (
              <div key={r.id} className="dock-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>{TRIGGER_ICONS[r.trigger_type] ?? '⚡'}</span>
                  {r.category && <span className="meta-text">{r.category}</span>}
                </div>
                <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2, marginTop: '0.5rem' }}>{r.name}</p>
                <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '0.25rem', flex: 1 }}>{r.description ?? r.instructions}</p>

                {/* Creator + stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.7rem', opacity: 0.5 }}>
                  <span>by {r.creator.name}</span>
                  <span>·</span>
                  <span>{r.run_count} runs</span>
                  {r.fork_count > 0 && <><span>·</span><span>{r.fork_count} forks</span></>}
                </div>

                {/* Fee badge */}
                {r.fee_required && r.fee_amount > 0 ? (
                  <span style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-cyan)', border: '1px solid var(--mesh-cyan)', borderRadius: '1rem', padding: '0.1rem 0.5rem' }}>${r.fee_amount.toFixed(2)} USDC/run</span>
                ) : (
                  <span style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-mint)', border: '1px solid var(--mesh-mint)', borderRadius: '1rem', padding: '0.1rem 0.5rem' }}>Free</span>
                )}

                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.75rem' }}>
                  <button onClick={() => forkRecipe(r.id)} disabled={forking === r.id} className="dock-btn-primary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem' }}>
                    {forking === r.id ? '...' : 'Fork'}
                  </button>
                  <button onClick={() => router.push(`/dashboard/recipes/marketplace/${r.id}`)} className="dock-btn-secondary" style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* TEMPLATES — pre-built */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
          {filteredTemplates.map((t) => (
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
                <button onClick={() => installTemplate(t.slug)} disabled={installing === t.slug} className="dock-btn-primary" style={{ flex: 1, padding: '0.4rem', fontSize: '0.75rem' }}>{installing === t.slug ? '...' : 'Add'}</button>
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
        <p style={{ opacity: 0.4, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Want to build something custom?</p>
        <button onClick={() => router.push('/dashboard/recipes/workspace')} className="dock-btn-primary" style={{ padding: '0.6rem 1.5rem' }}>Open Recipe Workspace</button>
      </div>
    </HarborShell>
  )
}
