'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'
import { OpenWalletConnect } from '@/components/OpenWalletConnect'
import { PayboxSigningKey } from '@/components/PayboxSigningKey'

interface WalletInfo {
  connected: boolean
  address: string | null
  chain: string | null
  chainLabel: string | null
  balance: { usdc: string; raw: string } | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [timezone, setTimezone] = useState('UTC')
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')
  const [dailyBriefing, setDailyBriefing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [wallet, setWallet] = useState<WalletInfo>({ connected: false, address: null, chain: null, chainLabel: null, balance: null })

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/user/settings', { credentials: 'include' })
      if (!res.ok) { router.push('/onboarding'); return }
      const { settings } = await res.json()
      setTimezone(settings.timezone ?? 'UTC')
      setQuietStart(settings.quiet_hours_start ?? '22:00')
      setQuietEnd(settings.quiet_hours_end ?? '08:00')
      setDailyBriefing(settings.daily_briefing ?? false)
    } catch { router.push('/onboarding') } finally { setLoading(false) }
  }, [router])

  const loadWallet = useCallback(async () => {
    try {
      const res = await fetch('/api/user/wallet', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setWallet(data)
      }
    } catch {
      // Non-fatal
    }
  }, [])

  useEffect(() => { loadSettings(); loadWallet() }, [loadSettings, loadWallet])

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
        credentials: 'include',
      })
      if (res.ok) {
        setStatus({ type: 'success', message: 'Saved' })
      } else {
        const data = await res.json()
        setStatus({ type: 'error', message: data.error ?? 'Failed to save' })
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to save' })
    } finally {
      setSaving(false)
      setTimeout(() => setStatus(null), 3000)
    }
  }

  const handleDeleteAccount = async () => {
    try {
      const res = await fetch('/api/user/settings', { method: 'DELETE', credentials: 'include' })
      if (res.ok) {
        router.push('/')
      }
    } catch {
      setStatus({ type: 'error', message: 'Failed to delete account' })
    }
  }

  if (loading) return <HarborShell title="Settings" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>

  return (
    <HarborShell title="Settings" showBack>
      {/* Status toast */}
      {status && (
        <div style={{
          padding: '0.5rem 1rem',
          marginBottom: '0.75rem',
          borderRadius: 'var(--radius-md)',
          border: `1.5px solid ${status.type === 'success' ? 'var(--mesh-mint)' : 'var(--mesh-peach)'}`,
          color: status.type === 'success' ? 'var(--mesh-mint)' : 'var(--mesh-peach)',
          fontFamily: "'Outfit', sans-serif",
          fontWeight: 700,
          fontSize: '0.85rem',
        }}>
          {status.message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
          <Link href="/dashboard/recipes" className="dock-card" style={{ alignItems: 'center', padding: '1rem', gap: '0.25rem' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
            <span className="meta-text" style={{ marginTop: '0.25rem' }}>Recipes</span>
          </Link>
          <Link href="/dashboard/integrations" className="dock-card" style={{ alignItems: 'center', padding: '1rem', gap: '0.25rem' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><circle cx="17" cy="17" r="3" /></svg>
            <span className="meta-text" style={{ marginTop: '0.25rem' }}>MCP</span>
          </Link>
          <Link href="/onboarding" className="dock-card" style={{ alignItems: 'center', padding: '1rem', gap: '0.25rem' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            <span className="meta-text" style={{ marginTop: '0.25rem' }}>Connect</span>
          </Link>
          <a href="#treasury" className="dock-card" style={{ alignItems: 'center', padding: '1rem', gap: '0.25rem', textDecoration: 'none', color: 'inherit' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 14h.01" />
            </svg>
            <span className="meta-text" style={{ marginTop: '0.25rem' }}>Treasury</span>
          </a>
        </div>

        {/* Timezone */}
        <div className="dock-card">
          <p className="section-title">Timezone</p>
          <select
            value={timezone}
            onChange={(e) => { setTimezone(e.target.value); save({ timezone: e.target.value }) }}
            className="dock-input"
            disabled={saving}
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>

        {/* Quiet Hours */}
        <div className="dock-card">
          <p className="section-title">Quiet Hours</p>
          <p style={{ fontSize: '0.75rem', opacity: 0.5, marginBottom: '0.5rem' }}>No proactive messages during these hours</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input
              type="time"
              value={quietStart}
              onChange={(e) => { setQuietStart(e.target.value); save({ quiet_hours_start: e.target.value }) }}
              className="dock-input"
              style={{ flex: 1 }}
              disabled={saving}
            />
            <span style={{ opacity: 0.4, fontStyle: 'italic' }}>to</span>
            <input
              type="time"
              value={quietEnd}
              onChange={(e) => { setQuietEnd(e.target.value); save({ quiet_hours_end: e.target.value }) }}
              className="dock-input"
              style={{ flex: 1 }}
              disabled={saving}
            />
          </div>
        </div>

        {/* Daily Briefing */}
        <div className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p className="section-title" style={{ marginBottom: '0.25rem' }}>Daily Briefing</p>
            <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>Calendar + email at 8 AM</p>
          </div>
          <button
            className="dock-toggle"
            data-on={String(dailyBriefing)}
            onClick={() => { const next = !dailyBriefing; setDailyBriefing(next); save({ daily_briefing: next }) }}
            disabled={saving}
          >
            <span className="dock-toggle-knob" style={{ left: dailyBriefing ? undefined : '2px', right: dailyBriefing ? '2px' : undefined }} />
          </button>
        </div>

        {/* Treasury */}
        <div id="treasury" className="dock-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /><path d="M6 14h.01" />
            </svg>
            <p className="section-title" style={{ margin: 0 }}>Treasury</p>
          </div>
          <OpenWalletConnect
            connected={wallet.connected}
            walletAddress={wallet.address}
            chainLabel={wallet.chainLabel}
            balance={wallet.balance?.usdc ?? null}
            onConnected={() => loadWallet()}
            onDisconnect={() => setWallet({ connected: false, address: null, chain: null, chainLabel: null, balance: null })}
          />
        </div>

        {/* Paybox */}
        <div className="dock-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /><path d="M7 14h4" />
            </svg>
            <p className="section-title" style={{ margin: 0 }}>Paybox</p>
          </div>
          <PayboxSigningKey />
        </div>

        {/* Danger Zone */}
        <div className="dock-card" style={{ borderColor: 'var(--mesh-peach)', marginTop: '1rem' }}>
          <p className="section-title" style={{ color: 'var(--mesh-peach)' }}>Danger Zone</p>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="dock-btn-secondary"
              style={{ borderColor: 'var(--mesh-peach)', color: 'var(--mesh-peach)', alignSelf: 'flex-start' }}
            >
              Delete Account
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--mesh-peach)' }}>This will permanently delete your account, all recipes, integrations, and message history.</p>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleDeleteAccount} className="dock-btn-secondary" style={{ borderColor: 'var(--mesh-peach)', color: 'var(--mesh-peach)' }}>
                  Yes, delete everything
                </button>
                <button onClick={() => setConfirmDelete(false)} className="dock-btn-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </HarborShell>
  )
}
