'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Totals {
  requests: number
  actualUsd: number
  chargedUsd: number
  paidUsd: number
  baselineUsd: number
  savedUsd: number
  savedPct: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

interface ModelRow {
  model: string | null
  requests: number
  actualUsd: number
  chargedUsd: number
  paidUsd: number
  baselineUsd: number
  savedUsd: number
  savedPct: number
}

interface SavingsResponse {
  user: Totals
  global: Totals
  byModel: ModelRow[]
}

function usd(n: number): string {
  if (n > 0 && n < 0.01) return '<$0.01'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fineUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
}

function compact(n: number): string {
  return n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
}

export default function SavingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<SavingsResponse | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/savings', { credentials: 'include' })
      if (res.status === 401) {
        router.push('/onboarding')
        return
      }
      if (res.ok) setData(await res.json())
    } catch {
      // Non-fatal — render the empty state.
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  const u = data?.user
  const g = data?.global
  const cacheRate =
    u && u.inputTokens + u.cacheReadTokens > 0
      ? (u.cacheReadTokens / (u.inputTokens + u.cacheReadTokens)) * 100
      : 0

  return (
    <HarborShell title="Savings" showBack backHref="/dashboard">
      <style>{`
        .savings-hero {
          background: linear-gradient(135deg, color-mix(in srgb, var(--mesh-mint) 22%, transparent), transparent);
          border: 1px solid color-mix(in srgb, var(--mesh-mint) 45%, transparent);
        }
        .savings-amount { color: var(--mesh-mint); font-weight: 700; line-height: 1; }
        .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
        .stat { display: flex; flex-direction: column; gap: 0.15rem; }
        .stat .val { font-size: 1.25rem; font-weight: 600; }
        .model-row { display: flex; align-items: center; justify-content: space-between; padding: 0.6rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
        .model-row:last-child { border-bottom: none; }
        .pill { font-size: 0.7rem; padding: 0.1rem 0.5rem; border-radius: 999px; background: color-mix(in srgb, var(--mesh-mint) 18%, transparent); color: var(--mesh-mint); }
      `}</style>

      {loading ? (
        <div className="dock-card">
          <p className="meta-text">Loading savings…</p>
        </div>
      ) : !u || u.requests === 0 ? (
        <div className="dock-card savings-hero" style={{ alignItems: 'center', padding: '2rem 1rem', textAlign: 'center' }}>
          <p className="section-title" style={{ margin: 0 }}>No inference yet</p>
          <p className="meta-text" style={{ marginTop: '0.5rem' }}>
            Once you chat with your assistant, we route each request to the cheapest capable
            model and cache the prompt prefix — then show you exactly what that saved vs calling
            the model direct.
          </p>
        </div>
      ) : (
        <>
          {/* Hero */}
          <div className="dock-card savings-hero" style={{ alignItems: 'center', padding: '1.75rem 1rem', textAlign: 'center', gap: '0.35rem' }}>
            <p className="meta-text" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              You&apos;ve saved
            </p>
            <span className="savings-amount" style={{ fontSize: '2.75rem' }}>{usd(u.savedUsd)}</span>
            <p className="meta-text" style={{ margin: 0 }}>
              <span className="pill">{u.savedPct.toFixed(0)}% off</span>{' '}
              vs calling the model direct ({fineUsd(u.baselineUsd)} → you paid {fineUsd(u.paidUsd)})
            </p>
          </div>

          {/* User stats */}
          <div className="dock-card">
            <p className="section-title">Your usage</p>
            <div className="stat-grid" style={{ marginTop: '0.5rem' }}>
              <div className="stat">
                <span className="val">{u.requests.toLocaleString()}</span>
                <span className="meta-text">requests</span>
              </div>
              <div className="stat">
                <span className="val">{compact(u.inputTokens + u.outputTokens)}</span>
                <span className="meta-text">tokens</span>
              </div>
              <div className="stat">
                <span className="val">{cacheRate.toFixed(0)}%</span>
                <span className="meta-text">prompt cached</span>
              </div>
            </div>
          </div>

          {/* Per-model breakdown */}
          {data!.byModel.length > 0 && (
            <div className="dock-card">
              <p className="section-title">Where it came from</p>
              <div style={{ marginTop: '0.25rem' }}>
                {data!.byModel.map((m) => (
                  <div className="model-row" key={m.model ?? 'unknown'}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontWeight: 500 }}>{m.model ?? 'unknown'}</span>
                      <span className="meta-text">{m.requests.toLocaleString()} requests</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="savings-amount" style={{ fontSize: '1rem' }}>{usd(m.savedUsd)}</span>
                      <span className="meta-text" style={{ display: 'block' }}>{m.savedPct.toFixed(0)}% saved</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Global tally */}
          {g && g.requests > 0 && (
            <div className="dock-card" style={{ borderColor: 'color-mix(in srgb, var(--mesh-cyan) 40%, transparent)' }}>
              <p className="section-title" style={{ color: 'var(--mesh-cyan)' }}>Across all of Dock</p>
              <p className="meta-text" style={{ marginTop: '0.25rem' }}>
                {usd(g.savedUsd)} saved over {g.requests.toLocaleString()} requests
                {g.baselineUsd > 0 && <> — {g.savedPct.toFixed(0)}% cheaper than direct.</>}
              </p>
            </div>
          )}

          <p className="meta-text" style={{ marginTop: '0.5rem', textAlign: 'center' }}>
            Baseline = the same request on the model it asked for, called direct &amp; uncached.
            You pay the routed + cached cost (plus a small margin), settled from your own wallet —
            always below baseline. Measured, not estimated.
          </p>
        </>
      )}
    </HarborShell>
  )
}
