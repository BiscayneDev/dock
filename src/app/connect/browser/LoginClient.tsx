'use client'

import { useState } from 'react'

type Phase = 'idle' | 'starting' | 'live' | 'saving' | 'done' | 'cancelled'

async function call(token: string, action: 'start' | 'finish' | 'cancel', ack = false): Promise<{ ok: boolean; error?: string; viewUrl?: string }> {
    try {
        const res = await fetch('/api/integrations/browser/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ t: token, action, ack }),
        })
        const j = (await res.json().catch(() => ({}))) as { error?: string; viewUrl?: string }
        return res.ok ? { ok: true, viewUrl: j.viewUrl } : { ok: false, error: j.error ?? 'Something went wrong. Try again.' }
    } catch {
        return { ok: false, error: 'Network hiccup. Try again.' }
    }
}

/** Starts the private browser on tap, shows the live view, saves on "I'm logged in". */
export function LoginClient({ token, site, needsConfirm = false }: { token: string; site: string; needsConfirm?: boolean }): React.JSX.Element {
    const [phase, setPhase] = useState<Phase>('idle')
    const [viewUrl, setViewUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [acked, setAcked] = useState(false)

    async function start(): Promise<void> {
        setPhase('starting')
        setError(null)
        const r = await call(token, 'start', acked)
        if (!r.ok || !r.viewUrl) {
            setError(r.error ?? 'Could not open the browser.')
            setPhase('idle')
            return
        }
        setViewUrl(r.viewUrl)
        setPhase('live')
    }

    async function finish(): Promise<void> {
        setPhase('saving')
        setError(null)
        const r = await call(token, 'finish')
        if (!r.ok) {
            setError(r.error ?? 'Could not save the login.')
            setPhase('live')
            return
        }
        setViewUrl(null)
        setPhase('done')
    }

    async function cancel(): Promise<void> {
        await call(token, 'cancel')
        setViewUrl(null)
        setPhase('cancelled')
    }

    if (phase === 'done') return <p>Connected. Head back to your texts, Dinghy has it from here.</p>
    if (phase === 'cancelled') return <p>Cancelled. Nothing was saved.</p>

    return (
        <div>
            {(phase === 'idle' || phase === 'starting') && needsConfirm ? (
                <p>
                    <label>
                        <input type="checkbox" checked={acked} onChange={(e) => setAcked(e.target.checked)} /> I understand Dinghy will keep a read-only login for {site}, and I
                        only want to connect a low-stakes site (not email, money or an identity account).
                    </label>
                </p>
            ) : null}
            {phase === 'idle' || phase === 'starting' ? (
                <button type="button" onClick={start} disabled={phase === 'starting' || (needsConfirm && !acked)}>
                    {phase === 'starting' ? 'opening a private browser…' : `open ${site}`}
                </button>
            ) : (
                <>
                    {viewUrl && (
                        <>
                            <iframe
                                title={`Private browser for ${site}`}
                                src={viewUrl}
                                style={{ width: '100%', height: '60vh', border: '1px solid #ccc', borderRadius: 8 }}
                                allow="clipboard-read; clipboard-write"
                            />
                            <p>
                                <a href={viewUrl} target="_blank" rel="noopener noreferrer">
                                    Browser not showing? Open it in a new tab
                                </a>
                            </p>
                        </>
                    )}
                    <button type="button" onClick={finish} disabled={phase === 'saving'}>
                        {phase === 'saving' ? 'saving…' : "i'm logged in"}
                    </button>{' '}
                    <button type="button" onClick={cancel} disabled={phase === 'saving'}>
                        cancel
                    </button>
                </>
            )}
            {error && <p role="alert">{error}</p>}
        </div>
    )
}
