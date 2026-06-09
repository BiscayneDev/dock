'use client'

import { useEffect, useState } from 'react'

// Manage the Paybox in-process wallet signing key (pbxk1.) from Settings:
// view status, add/replace, or remove. Backend: /api/integrations/paybox/signing-key
// (POST/DELETE) and the payboxCanSign flag from /api/integrations/status.
export function PayboxSigningKey() {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [canSign, setCanSign] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/integrations/status', { credentials: 'include' })
        if (res.ok) {
          const s = await res.json()
          setConnected(Boolean(s.paybox))
          setCanSign(Boolean(s.payboxCanSign))
        }
      } catch {
        // ignore — render disconnected state
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const saveKey = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/integrations/paybox/signing-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signingKey: key }),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setCanSign(true)
        setShowForm(false)
        setKey('')
      } else {
        setError(data.error ?? 'Could not save signing key')
      }
    } catch {
      setError('Could not save signing key')
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async () => {
    if (!confirm('Remove the Paybox signing key? Wallet signing and swaps will pause until you add one again.')) return
    try {
      const res = await fetch('/api/integrations/paybox/signing-key', {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setCanSign(false)
        setShowForm(false)
      }
    } catch {
      // ignore
    }
  }

  if (loading) return <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>Loading…</p>

  if (!connected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
          Connect Paybox to enable passkey-gated payments, secrets, and wallet signing.
        </p>
        <a
          href="/api/integrations/paybox/auth"
          className="dock-btn-primary"
          style={{ alignSelf: 'flex-start', padding: '0.4rem 1rem', fontSize: '0.8rem' }}
        >
          Connect Paybox
        </a>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>Wallet signing key</p>
          <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>
            {canSign ? 'Added — wallet signing & swaps enabled' : 'Not set — sign/swap will wait for approval'}
          </p>
        </div>
        {canSign && (
          <span className="meta-text" style={{ color: 'var(--mesh-mint)' }}>Added</span>
        )}
      </div>

      {!showForm && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowForm(true)}
            className="dock-btn-secondary"
            style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem' }}
          >
            {canSign ? 'Replace key' : 'Add key'}
          </button>
          {canSign && (
            <button
              onClick={removeKey}
              className="dock-btn-secondary"
              style={{ padding: '0.35rem 0.9rem', fontSize: '0.8rem', borderColor: 'var(--mesh-peach)', color: 'var(--mesh-peach)' }}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {showForm && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1.5px solid var(--ink)', paddingTop: '0.75rem' }}>
          <p style={{ fontSize: '0.75rem', opacity: 0.6 }}>
            Mint a <code>pbxk1.</code> key in the Paybox app (scoped to your granted wallets) and paste it here. It&apos;s
            stored encrypted and used to sign in-process — Paybox never sees it.
          </p>
          <input
            type="password"
            placeholder="pbxk1…."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="dock-input"
          />
          {error && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              onClick={saveKey}
              disabled={saving || !key.startsWith('pbxk1.')}
              className="dock-btn-primary"
              style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
            >
              {saving ? 'Saving…' : 'Save key'}
            </button>
            <button
              onClick={() => { setShowForm(false); setKey(''); setError(null) }}
              className="dock-btn-secondary"
              style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
