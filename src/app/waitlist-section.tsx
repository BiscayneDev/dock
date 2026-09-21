'use client'

import { useState, type FormEvent } from 'react'

export function WaitlistSection() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setStatus('error')
      setMessage('Please enter a valid email address.')
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error || 'Something went wrong. Please try again.')
        return
      }
      setStatus('success')
      setEmail('')
      setMessage("You're on the list. We'll reach out when we're ready for you.")
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  return (
    <section style={{ maxWidth: '42rem', margin: '4rem auto 0', padding: '0 1rem' }}>
      <div style={{
        border: '1.5px solid var(--ink)',
        borderRadius: 'var(--radius-lg)',
        padding: '2.5rem 2rem',
        textAlign: 'center',
        background: 'var(--cream)',
      }}>
        <span style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: '0.65rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
          opacity: 0.7,
          display: 'block',
          marginBottom: '0.75rem',
        }}>
          Private Beta
        </span>
        <h2 style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 'clamp(1.5rem, 3vw, 2rem)',
          fontWeight: 800,
          letterSpacing: '-0.02em',
          marginBottom: '0.75rem',
        }}>
          Get on board early.
        </h2>
        <p style={{
          fontSize: '0.95rem',
          lineHeight: 1.5,
          opacity: 0.7,
          maxWidth: '24rem',
          margin: '0 auto 1.75rem',
        }}>
          Dinghy is in private beta. Leave your email and we&apos;ll reach out when
          there&apos;s room on the boat.
        </p>

        {status === 'success' ? (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            border: '1.5px solid var(--mesh-mint)',
            borderRadius: '2rem',
            background: 'rgba(148, 196, 163, 0.15)',
            padding: '0.75rem 1.5rem',
            fontFamily: "'Outfit', sans-serif",
            fontSize: '0.9rem',
            fontWeight: 600,
            color: 'var(--ink)',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--mesh-mint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', maxWidth: '28rem', margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center' }}>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === 'loading'}
              style={{
                flex: 1,
                minWidth: '12rem',
                border: '1.5px solid var(--ink)',
                borderRadius: '2rem',
                padding: '0.75rem 1.25rem',
                fontFamily: "'Outfit', sans-serif",
                fontSize: '0.9rem',
                color: 'var(--ink)',
                background: 'transparent',
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              style={{
                border: '1.5px solid var(--ink)',
                borderRadius: '2rem',
                background: 'var(--ink)',
                color: 'var(--cream)',
                padding: '0.75rem 1.5rem',
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: status === 'loading' ? 'wait' : 'pointer',
                opacity: status === 'loading' ? 0.6 : 1,
              }}
            >
              {status === 'loading' ? 'Joining…' : 'Join the waitlist'}
            </button>
          </form>
        )}

        {status === 'error' && (
          <p style={{
            marginTop: '0.75rem',
            fontSize: '0.85rem',
            color: 'var(--mesh-peach)',
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 500,
          }}>
            {message}
          </p>
        )}
      </div>
    </section>
  )
}
