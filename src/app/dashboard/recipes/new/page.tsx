'use client'

import { Suspense, useState, useCallback, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

const INTEGRATIONS = [
  { key: 'google', label: 'Gmail & Calendar', icon: '📧' },
  { key: 'github', label: 'GitHub', icon: '🐙' },
  { key: 'notion', label: 'Notion', icon: '📝' },
  { key: 'openwallet', label: 'Wallet', icon: '💰' },
]

interface ParsedRecipe {
  name: string
  trigger_type: string
  trigger_config: Record<string, unknown>
  instructions: string
  category: string
}

export default function NewRecipePageWrapper() {
  return (
    <Suspense fallback={<HarborShell title="New Recipe" showBack backHref="/dashboard/recipes"><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>}>
      <NewRecipePage />
    </Suspense>
  )
}

function NewRecipePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ideaParam = searchParams.get('idea')
  const [description, setDescription] = useState(ideaParam ?? '')
  const [name, setName] = useState('')
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([])
  const [connectedIntegrations, setConnectedIntegrations] = useState<Record<string, boolean>>({})
  const [isPublic, setIsPublic] = useState(false)
  const [feeRequired, setFeeRequired] = useState(false)
  const [feeAmount, setFeeAmount] = useState(0)

  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<ParsedRecipe | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load connected integrations
  const loadIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/status', { credentials: 'include' })
      if (res.ok) setConnectedIntegrations(await res.json())
    } catch {}
  }, [])
  useEffect(() => { loadIntegrations() }, [loadIntegrations])

  const toggleIntegration = (key: string) => {
    setSelectedIntegrations((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
    setParsed(null) // Reset parsed when integrations change
  }

  const parseDescription = async () => {
    if (!description.trim()) return
    setParsing(true)
    setError(null)
    try {
      const res = await fetch('/api/recipes/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, integrations: selectedIntegrations }),
        credentials: 'include',
      })
      if (res.ok) {
        const data = await res.json()
        setParsed(data)
        if (!name && data.name) setName(data.name)
      } else {
        setError('Failed to parse description')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setParsing(false)
    }
  }

  const createRecipe = async () => {
    if (!parsed) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || parsed.name,
          description,
          instructions: parsed.instructions,
          trigger_type: parsed.trigger_type,
          trigger_config: parsed.trigger_config,
          category: parsed.category,
          enabled: true,
          notify_on_run: true,
          fee_amount: feeRequired ? feeAmount : 0,
          fee_required: feeRequired,
          is_public: isPublic,
        }),
        credentials: 'include',
      })
      if (res.ok) {
        const { recipe } = await res.json()
        router.push(`/dashboard/recipes/${recipe.id}`)
      } else {
        const data = await res.json()
        setError(data.error ?? 'Failed to create recipe')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const TRIGGER_LABELS: Record<string, string> = {
    schedule: '🕐 Schedule', email_event: '📧 Email', github_event: '🐙 GitHub',
    notion_event: '📝 Notion', keyword: '💬 Keyword', manual: '▶️ Manual',
  }

  return (
    <HarborShell title="New Recipe" showBack backHref="/dashboard/recipes">
      <p style={{ opacity: 0.5, fontSize: '0.9rem', marginBottom: '1.25rem' }}>
        Describe what you want Dock to do. We&apos;ll figure out the rest.
        <Link href="/dashboard/recipes/gallery" style={{ color: 'var(--mesh-cyan)', marginLeft: '0.35rem' }}>
          Check out what others have built
        </Link>
      </p>

      <div className="dock-card" style={{ gap: '1rem' }}>
        {/* Name */}
        <div>
          <span className="meta-text">Name (optional)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="morning-briefing"
            className="dock-input"
            style={{ marginTop: '0.25rem' }}
          />
        </div>

        {/* Description */}
        <div>
          <span className="meta-text">What should Dock do?</span>
          <textarea
            value={description}
            onChange={(e) => { setDescription(e.target.value); setParsed(null) }}
            rows={4}
            placeholder="Every weekday at 9am, summarize my overnight emails and today's calendar..."
            className="dock-input"
            style={{ marginTop: '0.25rem', resize: 'vertical' }}
          />
        </div>

        {/* Integrations */}
        <div>
          <span className="meta-text">Integrations</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
            {INTEGRATIONS.map((int) => {
              const selected = selectedIntegrations.includes(int.key)
              const connected = connectedIntegrations[int.key]
              return (
                <button
                  key={int.key}
                  onClick={() => toggleIntegration(int.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '2rem',
                    border: `1.5px ${selected ? 'solid' : 'dashed'} var(--ink)`,
                    background: selected ? 'var(--ink)' : 'transparent',
                    color: selected ? 'var(--cream)' : 'var(--ink)',
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    opacity: connected ? 1 : 0.5,
                  }}
                >
                  <span>{int.icon}</span>
                  <span>{int.label}</span>
                  {!connected && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>(not connected)</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Publishing options */}
        <div style={{ borderTop: '1.5px solid var(--ink)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem' }}>Publish to marketplace</span>
            <button className="dock-toggle" data-on={String(isPublic)} onClick={() => setIsPublic(!isPublic)}>
              <span className="dock-toggle-knob" style={{ left: isPublic ? undefined : '2px', right: isPublic ? '2px' : undefined }} />
            </button>
          </div>
          {isPublic && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem' }}>Charge a fee (USDC)</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <button className="dock-toggle" data-on={String(feeRequired)} onClick={() => setFeeRequired(!feeRequired)}>
                  <span className="dock-toggle-knob" style={{ left: feeRequired ? undefined : '2px', right: feeRequired ? '2px' : undefined }} />
                </button>
                {feeRequired && (
                  <input
                    type="number"
                    min={0.01}
                    max={100}
                    step={0.01}
                    value={feeAmount || ''}
                    onChange={(e) => setFeeAmount(Number(e.target.value))}
                    placeholder="1.00"
                    className="dock-input"
                    style={{ width: '5rem', textAlign: 'right' }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Parse + Preview */}
      {!parsed ? (
        <button
          onClick={parseDescription}
          disabled={parsing || !description.trim()}
          className="dock-btn-primary"
          style={{ width: '100%', marginTop: '1rem', padding: '0.75rem' }}
        >
          {parsing ? 'Analyzing...' : 'Create Recipe'}
        </button>
      ) : (
        <div className="dock-card" style={{ marginTop: '1rem' }}>
          <p className="section-title" style={{ marginBottom: '0.5rem' }}>Preview</p>
          <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <p>
              <span style={{ opacity: 0.5 }}>Trigger:</span>{' '}
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700 }}>
                {TRIGGER_LABELS[parsed.trigger_type] ?? parsed.trigger_type}
              </span>
            </p>
            {parsed.trigger_config && Object.keys(parsed.trigger_config).length > 0 && (
              <p style={{ opacity: 0.6, fontSize: '0.8rem' }}>
                {JSON.stringify(parsed.trigger_config)}
              </p>
            )}
            <div>
              <span style={{ opacity: 0.5 }}>Instructions:</span>
              <p style={{ marginTop: '0.15rem', opacity: 0.7 }}>{parsed.instructions}</p>
            </div>
          </div>

          {error && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)', marginTop: '0.5rem' }}>{error}</p>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button onClick={() => setParsed(null)} className="dock-btn-secondary" style={{ flex: 1 }}>
              Edit
            </button>
            <button
              onClick={createRecipe}
              disabled={saving}
              className="dock-btn-primary"
              style={{ flex: 1 }}
            >
              {saving ? 'Creating...' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {error && !parsed && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)', marginTop: '0.75rem', textAlign: 'center' }}>{error}</p>}
    </HarborShell>
  )
}
