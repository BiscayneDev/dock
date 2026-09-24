'use client'

import { useState, type FormEvent, type CSSProperties } from 'react'
import { normalizeEmail, normalizeName, normalizePhone, normalizeTwitterHandle } from '@/lib/waitlist'

const inputStyle: CSSProperties = {
  flex: '1 1 220px', minWidth: 0, height: '48px',
  border: 'none', boxShadow: 'inset 0 0 0 1px rgba(200,210,235,0.2)', borderRadius: '999px',
  padding: '0 20px', fontFamily: 'var(--sans)', fontSize: '15px',
  color: 'var(--shell)', background: 'var(--abyss)', outline: 'none',
}

export function WaitlistSection() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [twitter, setTwitter] = useState('')
  const [phone, setPhone] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const cleanName = normalizeName(name)
    if (!cleanName) {
      setStatus('error')
      setMessage('Please enter your name.')
      return
    }
    const cleanEmail = normalizeEmail(email)
    if (!cleanEmail) {
      setStatus('error')
      setMessage('Please enter a valid email address.')
      return
    }
    const phoneRaw = phone.trim()
    const cleanPhone = phoneRaw ? normalizePhone(phoneRaw) : null
    if (phoneRaw && !cleanPhone) {
      setStatus('error')
      setMessage("That mobile number doesn't look right.")
      return
    }
    const handle = normalizeTwitterHandle(twitter)
    if (handle === null) {
      setStatus('error')
      setMessage("That X handle doesn't look right - letters, numbers and _ only, up to 15.")
      return
    }

    setStatus('loading')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, name: cleanName, phone: cleanPhone, twitter: handle }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data.error || 'Something went wrong. Please try again.')
        return
      }
      setStatus('success')
      setEmail('')
      setName('')
      setTwitter('')
      setPhone('')
      setMessage("you're on the list. watch your inbox for your seat.")
    } catch {
      setStatus('error')
      setMessage('Something went wrong. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px', minHeight: '48px',
        boxShadow: 'inset 0 0 0 1px rgba(242,163,128,0.35)', borderRadius: '999px',
        background: 'rgba(242,163,128,0.08)', padding: '0 22px',
        fontFamily: 'var(--sans)', fontSize: '15px', color: 'var(--shell)',
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ember)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {message}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      <input
        type="text"
        required
        autoComplete="name"
        aria-label="Name"
        placeholder="your name"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={status === 'loading'}
        style={inputStyle}
      />
      <input
        type="tel"
        autoComplete="tel"
        inputMode="tel"
        aria-label="Mobile number (optional)"
        placeholder="mobile (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={status === 'loading'}
        style={inputStyle}
      />
      <input
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="X / Twitter handle (optional)"
        placeholder="@handle on x (optional)"
        value={twitter}
        onChange={(e) => setTwitter(e.target.value)}
        disabled={status === 'loading'}
        style={inputStyle}
      />
      <input
        type="email"
        required
        autoComplete="email"
        aria-label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'loading'}
        style={inputStyle}
      />
      <button
        type="submit"
        className="wl-btn"
        disabled={status === 'loading'}
        style={{
          flex: '0 0 auto', height: '48px', padding: '0 26px', borderRadius: '999px',
          fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '15px',
          color: 'var(--abyss)', background: '#F6EFE4', border: 'none',
          cursor: status === 'loading' ? 'wait' : 'pointer',
          opacity: status === 'loading' ? 0.6 : 1,
          transition: 'background .2s ease',
        }}
      >
        {status === 'loading' ? 'joining…' : 'join the waitlist'}
      </button>
      <p style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '12px', color: 'rgba(200,210,235,0.55)', marginTop: '2px' }}>
        your invite comes by email - then you just text dinghy. no spam.
      </p>
      {status === 'error' && (
        <p style={{ width: '100%', fontFamily: 'var(--sans)', fontSize: '14px', color: 'var(--ember)', marginTop: '4px' }}>
          {message}
        </p>
      )}
    </form>
  )
}
