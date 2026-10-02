'use client'

import { useCallback, useState } from 'react'
import { AdminShell } from '@/components/brand/AdminShell'

type Msg = { role: 'user' | 'assistant'; content: string }

function linkify(text: string): React.ReactNode[] {
    return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>{part}</a> : part
    )
}

export default function DemoChatPage() {
    const [slug, setSlug] = useState('dinghydemo861')
    const [text, setText] = useState('')
    const [history, setHistory] = useState<Msg[]>([])
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const call = useCallback(async (init?: { method: 'POST'; body: unknown }) => {
        setBusy(true); setErr(null)
        try {
            const res = await fetch(init ? '/api/admin/demo-chat' : `/api/admin/demo-chat?slug=${encodeURIComponent(slug)}`, {
                credentials: 'include', cache: 'no-store',
                ...(init ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
            })
            const json = await res.json() as { error?: string; history?: Msg[]; link?: string; sent?: string[] }
            if (!res.ok) { setErr(json.error ?? 'failed'); return }
            let h = json.history ?? history
            // Link and non-history sends (rich links) are not in history: show them inline.
            const extra = (json.sent ?? []).filter((s) => !h.some((m) => m.content === s))
            if (json.link) extra.push(json.link)
            h = [...h, ...extra.map((c) => ({ role: 'assistant' as const, content: c }))]
            setHistory(h)
        } catch { setErr('network error') } finally { setBusy(false) }
    }, [slug, history])

    return (
        <AdminShell title="Demo chat" showBack backHref="/admin">
            <div className="dock-card" style={{ display: 'grid', gap: 12 }}>
                <p className="meta-text">Synthetic Dinghy user with no phone. Same handler and Google connect flow as iMessage. Nothing is texted to anyone.</p>
                <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="demo slug" />
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="dock-btn-secondary" disabled={busy} onClick={() => void call()}>Load chat</button>
                    <button className="dock-btn-secondary" disabled={busy} onClick={() => void call({ method: 'POST', body: { slug, connect: true } })}>Get Google connect link</button>
                </div>
                <div style={{ display: 'grid', gap: 6, maxHeight: 420, overflow: 'auto' }}>
                    {history.map((m, i) => (
                        <div key={i} style={{ whiteSpace: 'pre-wrap', textAlign: m.role === 'user' ? 'right' : 'left' }}>{linkify(m.content)}</div>
                    ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return; setText(''); setHistory((h) => [...h, { role: 'user', content: t }]); void call({ method: 'POST', body: { slug, message: t } }) }} style={{ display: 'flex', gap: 8 }}>
                    <input style={{ flex: 1 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="message Dinghy" />
                    <button className="dock-btn-primary" disabled={busy} type="submit">{busy ? '...' : 'Send'}</button>
                </form>
                {err && <p className="meta-text">{err}</p>}
            </div>
        </AdminShell>
    )
}
