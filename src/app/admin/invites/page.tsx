'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminShell } from '@/components/brand/AdminShell'

type Person = {
    id: string; name: string | null; email: string; phone: string | null
    chatGuid: string | null; granted: number; used: number; remaining: number
}

function when(date: string): string {
    return new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function InviteGrantsPage() {
    const [people, setPeople] = useState<Person[]>([])
    const [state, setState] = useState<'loading' | 'ready' | 'unauthorized' | 'error'>('loading')
    const [target, setTarget] = useState('')
    const [amount, setAmount] = useState('5')
    const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
    const [busy, setBusy] = useState(false)

    const load = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/invites', { credentials: 'include', cache: 'no-store' })
            if (res.status === 403) { setState('unauthorized'); return }
            if (!res.ok) { setState('error'); return }
            const data = await res.json() as { people: Person[] }
            setPeople(data.people); setState('ready')
        } catch { setState('error') }
    }, [])
    useEffect(() => { void load() }, [load])

    const issue = useCallback(async () => {
        setBusy(true); setMessage(null)
        try {
            const trimmed = target.trim()
            const body = trimmed.includes('@')
                ? { email: trimmed, amount: Number(amount) }
                : { phone: trimmed, amount: Number(amount) }
            const res = await fetch('/api/admin/invites', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const json = await res.json() as { error?: string; granted?: number; chatGuid?: string }
            if (!res.ok) {
                setMessage({ kind: 'err', text: json.error ?? 'Something went wrong.' })
            } else {
                setMessage({ kind: 'ok', text: `Granted ${amount} invite${Number(amount) === 1 ? '' : 's'} — they now have ${json.granted}. They get them by texting Dinghy "invite".` })
                setTarget('')
                void load()
            }
        } catch {
            setMessage({ kind: 'err', text: 'Network error — try again.' })
        } finally { setBusy(false) }
    }, [target, amount, load])

    return <AdminShell title="Invite grants" showBack>
        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
            <div className="dock-card" style={{ gap: '0.5rem' }}>
                <span className="meta-text">Dinghy · Referral invites</span>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.03em' }}>Issue invites</h1>
                <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                    Grant invites to a member. They receive them in Dinghy: they text &ldquo;invite&rdquo; and get a
                    shareable link. Each redemption burns one invite.
                </p>
            </div>

            <div className="dock-card" style={{ gap: '0.6rem' }}>
                <label className="meta-text" htmlFor="invite-target">Member (active phone or email)</label>
                <input id="invite-target" value={target} onChange={(e) => setTarget(e.target.value)}
                    placeholder="+1 555 000 1234 or them@email.com"
                    style={{ padding: '0.55rem 0.7rem', borderRadius: '0.6rem', border: '1px solid var(--ink)', background: 'var(--cream-dim)', color: 'inherit' }} />
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label className="meta-text" htmlFor="invite-amount">Amount</label>
                    <input id="invite-amount" type="number" min={1} max={100} value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        style={{ width: '5rem', padding: '0.55rem 0.7rem', borderRadius: '0.6rem', border: '1px solid var(--ink)', background: 'var(--cream-dim)', color: 'inherit' }} />
                    <button className="dock-btn-secondary" onClick={() => void issue()} disabled={busy || !target.trim()}>
                        {busy ? 'Granting…' : 'Grant invites'}
                    </button>
                </div>
                {message && <p style={{ fontSize: '0.8rem', opacity: message.kind === 'ok' ? 0.85 : 1, color: message.kind === 'err' ? 'crimson' : undefined }}>{message.text}</p>}
            </div>

            {state === 'loading' && <div className="dock-card">Loading members…</div>}
            {state === 'unauthorized' && <div className="dock-card">You need an admin account. <Link href="/login">Sign in</Link></div>}
            {state === 'error' && <div className="dock-card"><strong>Could not load invite data.</strong> <button className="dock-btn-secondary" onClick={() => { setState('loading'); void load() }}>Retry</button></div>}
            {state === 'ready' && (
                <section style={{ display: 'grid', gap: '0.55rem' }}>
                    <h2 style={{ color: 'var(--cream)', fontSize: '1.05rem', fontWeight: 700 }}>Active members</h2>
                    {people.length === 0 && <div className="dock-card">No active members yet.</div>}
                    {people.map((p) => (
                        <div className="dock-card" key={p.id} style={{ gap: '0.3rem', padding: '0.9rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
                                <strong>{p.name || p.email}</strong>
                                {p.chatGuid
                                    ? <span>{p.remaining} left · {p.used} used · {p.granted} granted</span>
                                    : <span style={{ opacity: 0.6 }}>No bound chat yet</span>}
                            </div>
                            <div className="meta-text">{p.email} · {p.phone ?? 'no phone'}{p.chatGuid ? ` · chat ${p.chatGuid.slice(0, 18)}…` : ''}</div>
                            {p.chatGuid && (
                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                                    {[1, 5, 10].map((n) => (
                                        <button key={n} className="dock-btn-secondary" style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
                                            disabled={busy}
                                            onClick={async () => {
                                                setBusy(true)
                                                try {
                                                    const res = await fetch('/api/admin/invites', {
                                                        method: 'POST', credentials: 'include',
                                                        headers: { 'Content-Type': 'application/json' },
                                                        body: JSON.stringify({ chatGuid: p.chatGuid, amount: n }),
                                                    })
                                                    const json = await res.json() as { granted?: number; error?: string }
                                                    setMessage(res.ok && json.granted !== undefined
                                                        ? { kind: 'ok', text: `${p.name || p.email} now has ${json.granted} granted.` }
                                                        : { kind: 'err', text: json.error ?? 'Grant failed.' })
                                                    void load()
                                                } finally { setBusy(false) }
                                            }}>
                                            +{n}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </section>
            )}
        </div>
    </AdminShell>
}
