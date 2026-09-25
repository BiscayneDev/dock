'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell } from '@/components/brand/AdminShell'

type Person = {
  id: string; name: string | null; email: string; phone: string | null
  status: 'joined' | 'invited' | 'active'; createdAt: string
  line: string | null; lineAssignedAt: string | null; inviteSentAt: string | null; confirmationSentAt: string | null; introTextedAt: string | null
  firstTextAt: string | null; lastInboundAt: string | null; lastReplyAt: string | null
}
type OperatorData = {
  asOf: string; todayTimezone: string
  counts: {
    signups: number; waiting: number; awaitingFirstText: number
    activeSignups: number; active7d: number; retryingSends: number; todayCostUsd: number
  }
  queue: Person[]; recent: Person[]
}

function when(date: string | null): string {
  return date ? new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not yet'
}

function Journey({ person }: { person: Person }) {
  const steps = [
    ['Signed up', person.createdAt],
    ['Line assigned', person.lineAssignedAt],
    ['Invite sent', person.inviteSentAt],
    ['First text', person.firstTextAt],
    ['Last reply', person.lastReplyAt],
  ] as const
  return (
    <article className="dock-card" style={{ gap: '0.8rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div>
          <strong style={{ fontSize: '1rem' }}>{person.name || person.email}</strong>
          {person.name && <span style={{ opacity: 0.65, fontSize: '0.8rem', marginLeft: '0.5rem' }}>{person.email}</span>}
        </div>
        <span className="meta-text">{person.status === 'joined' ? (person.phone ? 'Waiting for approval' : 'Needs a number') : person.status === 'invited' ? 'Waiting for first text' : 'Active'}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
        {steps.map(([label, date], i) => (
          <div key={label} title={`${label}: ${when(date)}`} style={{ border: '1px solid var(--ink)', borderRadius: '0.65rem', padding: '0.45rem 0.6rem', minWidth: '6.8rem', opacity: date ? 1 : 0.45, background: date ? 'var(--cream)' : 'var(--cream-dim)' }}>
            <div className="meta-text">{i + 1}. {label}</div>
            <div style={{ fontSize: '0.74rem', marginTop: '0.2rem' }}>{when(date)}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '0.78rem', opacity: 0.68 }}>
        {person.phone || 'No phone on signup'} · {person.line ? `Dinghy line ${person.line}` : 'No line assigned'}
        {person.lastInboundAt && ` · Last text ${when(person.lastInboundAt)}`}
      </div>
    </article>
  )
}

export default function OperatorDashboard() {
  const [data, setData] = useState<OperatorData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/operator', { credentials: 'include', cache: 'no-store' })
      if (res.status === 403) { setState('unauthorized'); return }
      if (!res.ok) { setState('error'); return }
      setData(await res.json()); setState('ready')
    } catch { setState('error') }
  }, [])
  useEffect(() => { void load() }, [load])

  return <AdminShell title="Admin" showBack>
    {state === 'loading' && <div className="dock-card" style={{ marginTop: '2rem' }}>Loading operator view...</div>}
    {state === 'unauthorized' && <div className="dock-card" style={{ marginTop: '2rem' }}>You need an admin account to view this page. <Link href="/login">Sign in</Link></div>}
    {state === 'error' && <div className="dock-card" style={{ marginTop: '2rem' }}><strong>Could not load the operator view.</strong><p>No counts are shown until the data is available.</p><button className="dock-btn-secondary" style={{ alignSelf: 'start', marginTop: '0.7rem' }} onClick={() => { setState('loading'); void load() }}>Try again</button></div>}
    {state === 'ready' && data && <div style={{ display: 'grid', gap: '1rem' }}>
      <div className="dock-card" style={{ gap: '0.4rem' }}>
        <span className="meta-text">Dinghy · Beta operations</span>
        <h1 style={{ fontSize: '1.55rem', fontWeight: 800, letterSpacing: '-0.035em' }}>Who needs attention?</h1>
        <p style={{ fontSize: '0.82rem', opacity: 0.7 }}>Updated {when(data.asOf)} · Today uses {data.todayTimezone}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.6rem' }}>
        {[
          ['Waiting', data.counts.waiting, 'Awaiting approval'],
          ['First text', data.counts.awaitingFirstText, 'Invited, not yet active'],
          ['Active 7d', data.counts.active7d, 'Members who texted'],
          ['Retrying', data.counts.retryingSends, 'Pending sends with attempts'],
          ['Today cost', `$${Number(data.counts.todayCostUsd).toFixed(2)}`, 'Inference + sandbox'],
        ].map(([label, value, note]) => <div className="dock-card" key={label} style={{ gap: '0.15rem', padding: '0.9rem' }}><span className="meta-text">{label}</span><strong style={{ fontSize: '1.45rem' }}>{value}</strong><span style={{ fontSize: '0.69rem', opacity: 0.7 }}>{note}</span></div>)}
      </div>
      <section style={{ display: 'grid', gap: '0.55rem' }}>
        <h2 style={{ color: 'var(--cream)', fontSize: '1.12rem', fontWeight: 700 }}>Needs attention <span style={{ opacity: 0.65, fontSize: '0.75rem' }}>(oldest 50)</span></h2>
        {data.queue.length ? data.queue.map(p => <Journey key={p.id} person={p} />) : <div className="dock-card">No one waiting on the list or a first text.</div>}
      </section>
      <section style={{ display: 'grid', gap: '0.55rem' }}>
        <h2 style={{ color: 'var(--cream)', fontSize: '1.12rem', fontWeight: 700 }}>Active signups <span style={{ opacity: 0.65, fontSize: '0.75rem' }}>(recent 25 of {data.counts.activeSignups})</span></h2>
        {data.recent.length ? data.recent.map(p => <Journey key={p.id} person={p} />) : <div className="dock-card">No first texts recorded yet.</div>}
      </section>
      <nav style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap' }}>
        <Link className="dock-btn-secondary" href="/admin/legacy">Legacy metrics</Link>
        <Link className="dock-btn-secondary" href="/admin/shipyard">Shipyard settlements</Link>
      </nav>
    </div>}
  </AdminShell>
}
