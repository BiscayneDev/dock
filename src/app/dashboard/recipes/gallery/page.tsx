'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Template { slug: string; name: string; description: string; category: string; requiredIntegrations: string[]; triggerType: string; previewOutput: string; icon: string }
interface PublicRecipe { id: string; name: string; description: string | null; instructions: string; trigger_type: string; category: string | null; fee_amount: number; fee_required: boolean; run_count: number; fork_count: number; creator: { name: string; username: string | null }; created_at: string }
interface X402Service { name: string; description: string; url: string; price: number | null; category: string | null; recipe_idea: string }

type Tab = 'marketplace' | 'templates' | 'ideas'
type Pricing = 'all' | 'free' | 'paid'

const TRIGGER_ICONS: Record<string, string> = {
  schedule: '🕐', email_event: '📧', github_event: '🐙', notion_event: '📝', keyword: '💬', manual: '▶️',
}

export default function GalleryPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('marketplace')
  const [templates, setTemplates] = useState<Template[]>([])
  const [recipes, setRecipes] = useState<PublicRecipe[]>([])
  const [ideas, setIdeas] = useState<X402Service[]>([])
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

  const loadIdeas = useCallback(async () => {
    try {
      const res = await fetch('/api/x402/trending')
      if (res.ok) setIdeas((await res.json()).services ?? [])
    } catch {}
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadTemplates(), loadRecipes(), loadIdeas()]).finally(() => setLoading(false))
  }, [loadTemplates, loadRecipes, loadIdeas])

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
        <button onClick={() => setTab('marketplace')} className={tab === 'marketplace' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          Marketplace {recipes.length > 0 && <span style={{ opacity: 0.5, marginLeft: '0.25rem' }}>({recipes.length})</span>}
        </button>
        <button onClick={() => setTab('templates')} className={tab === 'templates' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          Templates
        </button>
        <button onClick={() => setTab('ideas')} className={tab === 'ideas' ? 'dock-btn-primary' : 'dock-btn-secondary'} style={{ flex: 1, padding: '0.5rem', fontSize: '0.85rem' }}>
          Ideas {ideas.length > 0 && <span style={{ opacity: 0.5, marginLeft: '0.25rem' }}>({ideas.length})</span>}
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

      {/* IDEAS — x402 services as recipe inspiration */}
      {tab === 'ideas' && (
        ideas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Loading ideas...</p>
            <p style={{ opacity: 0.5, fontSize: '0.85rem' }}>Discovering x402 services your agent can use.</p>
          </div>
        ) : (
          <>
            <p style={{ opacity: 0.5, fontSize: '0.85rem', marginBottom: '1rem' }}>Paid APIs your agent can access via x402. What would you build?</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.75rem' }}>
              {ideas.map((s, i) => (
                <div key={i} className="dock-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>⚡</span>
                    {s.category && <span className="meta-text">{s.category}</span>}
                  </div>
                  <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.2, marginTop: '0.5rem' }}>{s.name}</p>
                  <p style={{ fontSize: '0.75rem', opacity: 0.5, marginTop: '0.25rem' }}>{s.description.slice(0, 120)}{s.description.length > 120 ? '...' : ''}</p>

                  {s.price != null && s.price > 0 && (
                    <span style={{ display: 'inline-block', marginTop: '0.4rem', fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-cyan)', border: '1px solid var(--mesh-cyan)', borderRadius: '1rem', padding: '0.1rem 0.5rem' }}>${typeof s.price === 'number' ? s.price.toFixed(2) : s.price} / call</span>
                  )}

                  {/* Recipe idea */}
                  <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--ink)', opacity: 0.7 }}>
                    <p style={{ fontSize: '0.75rem', fontStyle: 'italic' }}>💡 {s.recipe_idea}</p>
                  </div>

                  <button
                    onClick={() => router.push(`/dashboard/recipes/new?idea=${encodeURIComponent(s.recipe_idea + '. Use the ' + s.name + ' API via x402.')}`)}
                    className="dock-btn-primary"
                    style={{ width: '100%', marginTop: '0.75rem', padding: '0.4rem', fontSize: '0.75rem' }}
                  >
                    Build with this
                  </button>
                </div>
              ))}
            </div>
          </>
        )
      )}

      <div style={{ marginTop: '2rem', textAlign: 'center' }}>
        <p style={{ opacity: 0.4, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Have a recipe others would love?</p>
        <button onClick={() => router.push('/dashboard/recipes/new')} className="dock-btn-secondary">Publish your own</button>
      </div>
    </HarborShell>
  )
}
