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
      setMessage("You're on the list. We'll text you when a seat opens.")
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px',
        border: '1px solid rgba(107,156,224,0.3)', borderRadius: '999px',
        background: 'rgba(107,156,224,0.08)', padding: '12px 24px',
        fontFamily: 'var(--mono)', fontSize: '12.5px', color: '#cfe0f2',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {message}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px', maxWidth: '420px', margin: '0 auto', flexWrap: 'wrap', justifyContent: 'center' }}>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'loading'}
        style={{
          flex: 1, minWidth: '180px',
          border: '1px solid rgba(110,130,156,0.2)', borderRadius: '999px',
          padding: '12px 20px', fontFamily: 'var(--mono)', fontSize: '13px',
          color: '#e8eef6', background: 'rgba(5,10,24,0.6)', outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        style={{
          fontFamily: 'var(--mono)', fontSize: '12.5px', letterSpacing: '0.18em',
          textTransform: 'uppercase', padding: '12px 24px', borderRadius: '999px',
          color: '#071222', background: '#cfe0f2', border: 'none',
          cursor: status === 'loading' ? 'wait' : 'pointer',
          opacity: status === 'loading' ? 0.6 : 1,
          transition: 'background .3s ease, transform .3s ease',
        }}
      >
        {status === 'loading' ? 'joining…' : 'join the waitlist'}
      </button>
      {status === 'error' && (
        <p style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: '11px', color: '#e48d6c', marginTop: '8px' }}>
          {message}
        </p>
      )}
    </form>
  )
}
