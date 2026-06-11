'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface Totals {
  requests: number
  providerCostUsd: number
  revenueUsd: number
  baselineUsd: number
  marginUsd: number
  userSavedUsd: number
}
interface Settlement {
  settledUsd: number
  settledCount: number
  pendingUsd: number
  inflightCount: number
  failedCount: number
}
interface ModelRow {
  model: string
  requests: number
  providerCostUsd: number
  revenueUsd: number
  marginUsd: number
}
interface UserRow {
  userId: string
  name: string | null
  requests: number
  revenueUsd: number
  providerCostUsd: number
  marginUsd: number
  outstandingUsd: number
}
interface SettlementRow {
  id: string
  status: 'pending' | 'settled' | 'failed'
  owedUsd: number
  signature: string | null
  network: string
  failureReason: string | null
  createdAt: string
  name: string | null
}
interface Overview {
  totals: Totals
  settlement: Settlement
  byModel: ModelRow[]
  topUsers: UserRow[]
  recentSettlements: SettlementRow[]
  config: {
    network: string
    treasury: string | null
    treasuryBalanceUsdc: number | null
    marginPct: number
    thresholdUsd: number
  }
}

function usd(n: number, dp = 4): string {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: dp })}`
}
function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s
}

export default function ShipyardAdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/shipyard', { credentials: 'include' })
      if (res.status === 403) {
        setData(null)
        return
      }
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const retry = async (settlementId: string) => {
    setBusy(settlementId)
    try {
      await fetch('/api/admin/shipyard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ settlementId }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <HarborShell title="Shipyard" showBack backHref="/admin">
        <div style={{ paddingTop: '4rem', textAlign: 'center', opacity: 0.5 }}>Loading…</div>
      </HarborShell>
    )
  }
  if (!data) {
    return (
      <HarborShell title="Shipyard" showBack backHref="/admin">
        <div style={{ paddingTop: '4rem', textAlign: 'center', opacity: 0.5 }}>Access denied</div>
      </HarborShell>
    )
  }

  const { totals, settlement, byModel, topUsers, recentSettlements, config } = data
  const explorer = (sig: string) =>
    `https://explorer.solana.com/tx/${sig}${config.network === 'devnet' ? '?cluster=devnet' : ''}`

  const kpis = [
    { label: 'Revenue', value: usd(totals.revenueUsd), accent: 'var(--mesh-mint)' },
    { label: 'Provider cost', value: usd(totals.providerCostUsd), accent: 'var(--mesh-peach)' },
    { label: 'Net margin', value: usd(totals.marginUsd), accent: 'var(--mesh-mint)' },
    {
      label: 'Treasury',
      value: config.treasuryBalanceUsdc == null ? '—' : usd(config.treasuryBalanceUsdc, 2),
      accent: 'var(--mesh-cyan)',
    },
  ]

  return (
    <HarborShell title="Shipyard" showBack backHref="/admin">
      <style>{`
        .sy-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.6rem; }
        .sy-kpi { align-items: center; text-align: center; padding: 1rem 0.5rem; }
        .sy-kpi .v { font-size: 1.4rem; font-weight: 700; line-height: 1; }
        .sy-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; padding: 0.45rem 0; border-bottom: 1px solid color-mix(in srgb, currentColor 8%, transparent); }
        .sy-row:last-child { border-bottom: none; }
        .sy-pill { font-size: 0.65rem; padding: 0.08rem 0.45rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
        .sy-num { font-variant-numeric: tabular-nums; }
        .sy-mono { font-family: ui-monospace, monospace; font-size: 0.72rem; }
      `}</style>

      {/* Headline KPIs */}
      <div className="sy-grid">
        {kpis.map((k) => (
          <div key={k.label} className="dock-card sy-kpi">
            <span className="v" style={{ color: k.accent }}>{k.value}</span>
            <span className="meta-text" style={{ marginTop: '0.25rem' }}>{k.label}</span>
          </div>
        ))}
      </div>

      {/* Settlement / collection health */}
      <div className="dock-card">
        <p className="section-title">Collection</p>
        <div className="sy-row"><span className="meta-text">Settled to treasury</span><span className="sy-num" style={{ color: 'var(--mesh-mint)' }}>{usd(settlement.settledUsd)} · {settlement.settledCount}</span></div>
        <div className="sy-row"><span className="meta-text">Uncollected (pending)</span><span className="sy-num">{usd(settlement.pendingUsd)}</span></div>
        <div className="sy-row"><span className="meta-text">In-flight</span><span className="sy-num">{settlement.inflightCount}</span></div>
        <div className="sy-row"><span className="meta-text">Failed / stuck</span><span className="sy-num" style={{ color: settlement.failedCount ? 'var(--mesh-peach)' : undefined }}>{settlement.failedCount}</span></div>
        <div className="sy-row"><span className="meta-text">Saved for users (vs direct)</span><span className="sy-num">{usd(totals.userSavedUsd)}</span></div>
      </div>

      {/* Config */}
      <div className="dock-card">
        <p className="section-title">Config</p>
        <div className="sy-row"><span className="meta-text">Network</span><span>{config.network}</span></div>
        <div className="sy-row"><span className="meta-text">Treasury</span><span className="sy-mono">{config.treasury ? short(config.treasury) : 'unset'}</span></div>
        <div className="sy-row"><span className="meta-text">Margin</span><span>{config.marginPct}%</span></div>
        <div className="sy-row"><span className="meta-text">Settle threshold</span><span>{usd(config.thresholdUsd, 2)}</span></div>
        <div className="sy-row"><span className="meta-text">Requests metered</span><span className="sy-num">{totals.requests}</span></div>
      </div>

      {/* By model */}
      <div className="dock-card">
        <p className="section-title">By model</p>
        {byModel.map((m) => (
          <div className="sy-row" key={m.model}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500 }}>{m.model}</span>
              <span className="meta-text">{m.requests} req · cost {usd(m.providerCostUsd)}</span>
            </div>
            <span className="sy-num" style={{ color: 'var(--mesh-mint)' }}>+{usd(m.marginUsd)}</span>
          </div>
        ))}
      </div>

      {/* Top users */}
      <div className="dock-card">
        <p className="section-title">Users</p>
        {topUsers.map((u) => (
          <div className="sy-row" key={u.userId}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontWeight: 500 }}>{u.name ?? short(u.userId)}</span>
              <span className="meta-text">{u.requests} req · rev {usd(u.revenueUsd)}</span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="sy-num" style={{ color: 'var(--mesh-mint)' }}>+{usd(u.marginUsd)}</span>
              {u.outstandingUsd > 0 && (
                <span className="meta-text" style={{ display: 'block', color: 'var(--mesh-peach)' }}>owes {usd(u.outstandingUsd)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Recent settlements */}
      <div className="dock-card">
        <p className="section-title">Recent settlements</p>
        {recentSettlements.length === 0 && <p className="meta-text">None yet.</p>}
        {recentSettlements.map((s) => {
          const color =
            s.status === 'settled' ? 'var(--mesh-mint)' : s.status === 'failed' ? 'var(--mesh-peach)' : 'var(--mesh-yellow)'
          return (
            <div className="sy-row" key={s.id}>
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span>
                  <span className="sy-pill" style={{ background: color, color: 'var(--bg, #111)' }}>{s.status}</span>{' '}
                  <span className="sy-num">{usd(s.owedUsd)}</span>
                </span>
                <span className="meta-text">{s.name ?? '—'} · {s.createdAt}</span>
                {s.status === 'settled' && s.signature && (
                  <a className="sy-mono" href={explorer(s.signature)} target="_blank" rel="noreferrer" style={{ color: 'var(--mesh-cyan)' }}>{short(s.signature)} ↗</a>
                )}
                {s.status === 'failed' && s.failureReason && (
                  <span className="meta-text" style={{ opacity: 0.6 }}>{s.failureReason.slice(0, 60)}</span>
                )}
              </div>
              {s.status === 'failed' && (
                <button
                  onClick={() => retry(s.id)}
                  disabled={busy === s.id}
                  className="dock-btn-secondary"
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.72rem', whiteSpace: 'nowrap' }}
                >
                  {busy === s.id ? '…' : 'Retry'}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </HarborShell>
  )
}
