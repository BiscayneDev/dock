'use client'

import { useCallback, useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface PublicRecipe {
  id: string; name: string; description: string | null; instructions: string
  trigger_type: string; category: string | null; fee_amount: number; fee_required: boolean
  run_count: number; fork_count: number; created_at: string
  required_integrations: string[]
  creator: { name: string; username: string | null }
}

const TRIGGER_LABELS: Record<string, string> = {
  schedule: 'Schedule', email_event: 'Email', github_event: 'GitHub',
  notion_event: 'Notion', keyword: 'Keyword', manual: 'Manual',
}

const INTEGRATION_META: Record<string, { label: string; desc: string; icon: string; authPath: string }> = {
  google: { label: 'Google', desc: 'Gmail and Google Calendar', icon: '📧', authPath: '/api/integrations/google/auth' },
  github: { label: 'GitHub', desc: 'Repos, issues, and PRs', icon: '🐙', authPath: '/api/integrations/github/auth' },
  notion: { label: 'Notion', desc: 'Pages and databases', icon: '📝', authPath: '/api/integrations/notion/auth' },
  openwallet: { label: 'MoonPay Wallet', desc: 'Agent wallet & payments', icon: '💰', authPath: '' },
}

export default function MarketplaceRecipeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [recipe, setRecipe] = useState<PublicRecipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [forking, setForking] = useState(false)
  const [connected, setConnected] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    try {
      const [recipeRes, statusRes] = await Promise.all([
        fetch(`/api/recipes/public?search=&limit=50`),
        fetch('/api/integrations/status', { credentials: 'include' }),
      ])
      if (recipeRes.ok) {
        const data = await recipeRes.json()
        const found = (data.recipes ?? []).find((r: PublicRecipe) => r.id === id)
        if (found) setRecipe(found)
      }
      if (statusRes.ok) setConnected(await statusRes.json())
    } catch {} finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const fork = async () => {
    setForking(true)
    try {
      const res = await fetch(`/api/recipes/${id}/fork`, { method: 'POST', credentials: 'include' })
      if (res.ok) {
        const d = await res.json()
        router.push(d.editUrl ?? `/dashboard/recipes/${d.recipe.id}`)
      }
    } catch {} finally { setForking(false) }
  }

  if (loading || !recipe) {
    return (
      <HarborShell title="Recipe" showBack backHref="/dashboard/recipes/gallery">
        <div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>{loading ? 'Loading...' : 'Not found.'}</div>
      </HarborShell>
    )
  }

  const requiredIntegrations = recipe.required_integrations ?? []
  const missingIntegrations = requiredIntegrations.filter((key) => !connected[key])
  const allConnected = missingIntegrations.length === 0

  return (
    <HarborShell title={recipe.name} showBack backHref="/dashboard/recipes/gallery">
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
        <p style={{ opacity: 0.5, fontSize: '0.8rem' }}>
          Made with Dock | By {recipe.creator.name}
          {recipe.creator.username && <span> @{recipe.creator.username}</span>}
        </p>
      </div>

      {/* Description */}
      <div className="dock-card" style={{ marginBottom: '1.25rem' }}>
        <span className="meta-text">Description</span>
        <p style={{ fontSize: '0.9rem', opacity: 0.7, marginTop: '0.35rem', lineHeight: 1.6 }}>
          {recipe.description ?? recipe.instructions}
        </p>
      </div>

      {/* Integrations section — the Poke-style connection screen */}
      {requiredIntegrations.length > 0 && (
        <div className="dock-card" style={{ marginBottom: '1.25rem' }}>
          <span className="meta-text">Integrations</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            {requiredIntegrations.map((key) => {
              const meta = INTEGRATION_META[key]
              if (!meta) return null
              const isConnected = connected[key]

              return (
                <div
                  key={key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1.5px solid var(--ink)',
                    opacity: isConnected ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>{meta.icon}</span>
                    <div>
                      <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>{meta.label}</p>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>{meta.desc}</p>
                    </div>
                  </div>
                  {isConnected ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--mesh-mint)', fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>Connected</span>
                  ) : meta.authPath ? (
                    <a
                      href={meta.authPath}
                      className="dock-btn-primary"
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', textDecoration: 'none' }}
                    >
                      Connect
                    </a>
                  ) : (
                    <button
                      onClick={() => router.push('/onboarding')}
                      className="dock-btn-primary"
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
                    >
                      Connect
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="dock-card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <span className="meta-text">Trigger</span>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem' }}>{TRIGGER_LABELS[recipe.trigger_type] ?? recipe.trigger_type}</p>
          </div>
          <div>
            <span className="meta-text">Runs</span>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem' }}>{recipe.run_count}</p>
          </div>
          <div>
            <span className="meta-text">Forks</span>
            <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem' }}>{recipe.fork_count}</p>
          </div>
          {recipe.fee_required && recipe.fee_amount > 0 && (
            <div>
              <span className="meta-text">Fee</span>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, marginTop: '0.15rem', color: 'var(--mesh-cyan)' }}>${recipe.fee_amount.toFixed(2)} USDC</p>
            </div>
          )}
        </div>
      </div>

      {/* Category + pricing badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1.5rem' }}>
        {recipe.category && (
          <span style={{ fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, border: '1px solid var(--ink)', borderRadius: '1rem', padding: '0.15rem 0.5rem', opacity: 0.6 }}>{recipe.category}</span>
        )}
        {recipe.fee_required && recipe.fee_amount > 0 ? (
          <span style={{ fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-cyan)', border: '1px solid var(--mesh-cyan)', borderRadius: '1rem', padding: '0.15rem 0.5rem' }}>Paid</span>
        ) : (
          <span style={{ fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-mint)', border: '1px solid var(--mesh-mint)', borderRadius: '1rem', padding: '0.15rem 0.5rem' }}>Free</span>
        )}
        <span style={{ fontSize: '0.7rem', fontFamily: "'Outfit', sans-serif", fontWeight: 700, border: '1px solid var(--ink)', borderRadius: '1rem', padding: '0.15rem 0.5rem', opacity: 0.6 }}>
          Published {new Date(recipe.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Get Started / Fork button */}
      {!allConnected && missingIntegrations.length > 0 ? (
        <div style={{ textAlign: 'center', opacity: 0.6, marginBottom: '0.5rem' }}>
          <p style={{ fontSize: '0.8rem' }}>Connect {missingIntegrations.length === 1 ? 'the integration' : 'all integrations'} above to use this recipe</p>
        </div>
      ) : null}

      <button
        onClick={fork}
        disabled={forking}
        className="dock-btn-primary"
        style={{ width: '100%', padding: '0.85rem', fontSize: '1rem' }}
      >
        {forking ? 'Adding...' : 'Get Started'}
      </button>
    </HarborShell>
  )
}
