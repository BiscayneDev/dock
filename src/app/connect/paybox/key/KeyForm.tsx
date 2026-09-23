'use client'

import { useState } from 'react'
import styles from './KeyForm.module.css'

/** Masked paste field for a pbxk1. signing key. Posts once; never echoes it. */
export function KeyForm({ token }: { token: string }): React.JSX.Element {
    const [key, setKey] = useState('')
    const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
    const [error, setError] = useState<string | null>(null)

    async function submit(e: React.FormEvent): Promise<void> {
        e.preventDefault()
        setState('saving')
        setError(null)
        try {
            const res = await fetch('/api/integrations/paybox/key-link', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ t: token, signingKey: key }),
            })
            const j = (await res.json().catch(() => ({}))) as { error?: string }
            if (!res.ok) {
                setError(j.error ?? 'Something went wrong. Try again.')
                setState('idle')
                return
            }
            setKey('')
            setState('saved')
        } catch {
            setError('Network hiccup. Try again.')
            setState('idle')
        }
    }

    if (state === 'saved') {
        return <p className={styles.saved}>Saved. Head back to your texts, Dinghy has it from here.</p>
    }

    return (
        <form className={styles.form} onSubmit={submit}>
            <label className={styles.label} htmlFor="pbxk">signing key</label>
            <input
                id="pbxk"
                className={styles.input}
                type="password"
                name="pbxk"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="pbxk1…"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
            />
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.button} type="submit" disabled={state === 'saving' || !key.trim()}>
                {state === 'saving' ? 'saving…' : 'save key'}
            </button>
        </form>
    )
}
