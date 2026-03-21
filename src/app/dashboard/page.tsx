'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [timezone, setTimezone] = useState('UTC')
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')
  const [dailyBriefing, setDailyBriefing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (!res.ok) { router.push('/onboarding'); return }
      setLoading(false)
    } catch { router.push('/onboarding') }
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <HarborShell title="Settings" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>

  return (
    <HarborShell title="Settings" showBack>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>

        {/* Quick links */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
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
        </div>

        {/* Timezone */}
        <div className="dock-card">
          <p className="section-title">Timezone</p>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="dock-input">
            {Intl.supportedValuesOf('timeZone').map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>

        {/* Quiet Hours */}
        <div className="dock-card">
          <p className="section-title">Quiet Hours</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <input type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} className="dock-input" style={{ flex: 1 }} />
            <span style={{ opacity: 0.4, fontStyle: 'italic' }}>to</span>
            <input type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} className="dock-input" style={{ flex: 1 }} />
          </div>
        </div>

        {/* Daily Briefing */}
        <div className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p className="section-title" style={{ marginBottom: '0.25rem' }}>Daily Briefing</p>
            <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>Calendar + email at 8 AM</p>
          </div>
          <button className="dock-toggle" data-on={String(dailyBriefing)} onClick={() => setDailyBriefing(!dailyBriefing)}>
            <span className="dock-toggle-knob" style={{ left: dailyBriefing ? undefined : '2px', right: dailyBriefing ? '2px' : undefined }} />
          </button>
        </div>

        {/* Danger */}
        <div className="dock-card" style={{ borderColor: 'var(--mesh-peach)', marginTop: '1rem' }}>
          <p className="section-title" style={{ color: 'var(--mesh-peach)' }}>Danger Zone</p>
          <button className="dock-btn-secondary" style={{ borderColor: 'var(--mesh-peach)', color: 'var(--mesh-peach)', alignSelf: 'flex-start' }}>
            Delete Account
          </button>
        </div>
      </div>
    </HarborShell>
  )
}
