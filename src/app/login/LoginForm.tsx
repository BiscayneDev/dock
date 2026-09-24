'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import styles from './login.module.css'

const DINGHY_SMS = 'sms:+16282647754'

function formatUs(v: string): string {
  const d = v.replace(/\D/g, '').replace(/^1(?=\d{10})/, '').slice(0, 10)
  if (d.length < 4) return d
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

export function LoginForm({ notice }: { notice?: string | null }): React.JSX.Element {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [e164, setE164] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/auth/dinghy/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Something went wrong. Try again.'); return }
      setE164(data.phone); setStep('code'); setCode('')
      if (e === undefined) setResent(true)
    } catch { setError('Something went wrong. Try again.') } finally { setBusy(false) }
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/auth/dinghy/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: e164, code }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'That code didn\u2019t work.'); return }
      window.location.assign(data.redirect ?? '/profile')
    } catch { setError('Something went wrong. Try again.') } finally { setBusy(false) }
  }

  if (step === 'code') {
    return (
      <form onSubmit={verify}>
        <h1 className={styles.title}>Check your <em>texts</em></h1>
        <p className={styles.sub}>If {formatUs(e164)} uses Dinghy, a 6-digit code is on its way in your Dinghy thread.</p>
        <div className={styles.newHere}>
          <p><strong>New to Dinghy?</strong> No code will come until you&rsquo;re in the beta.</p>
          <Link href="/#waitlist" className={styles.newHereCta}>Get on the waitlist <span aria-hidden="true">{"\u2192"}</span></Link>
        </div>
        <label className={styles.label} htmlFor="code">Sign-in code</label>
        <div className={styles.field}>
          <input id="code" className={`${styles.input} ${styles.code}`} inputMode="numeric" autoComplete="one-time-code" autoFocus
            maxLength={6} placeholder="000000" value={code} onChange={(ev) => setCode(ev.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        {resent && !error && <p className={styles.note}>New code sent.</p>}
        <button className={styles.button} type="submit" disabled={busy || code.length !== 6}>{busy ? 'checking\u2026' : 'sign in'} <span aria-hidden="true">{"\u2192"}</span></button>
        <div className={styles.row}>
          <button type="button" className={styles.link} onClick={() => { setStep('phone'); setError(null); setResent(false) }}>Use a different number</button>
          <button type="button" className={styles.link} disabled={busy} onClick={() => sendCode()}>Send a new code</button>
        </div>
        <p className={styles.divider}>Have an invite code? <a href={DINGHY_SMS}>Text it to Dinghy</a> first, then sign in.</p>
      </form>
    )
  }

  return (
    <form onSubmit={sendCode}>
      <h1 className={styles.title}>Sign in to <em>Dinghy</em></h1>
      <p className={styles.sub}>We&rsquo;ll text a code to your Dinghy thread.</p>
      {notice && <p className={styles.note} style={{ margin: '0 0 18px' }}>{notice}</p>}
      <label className={styles.label} htmlFor="phone">Phone number</label>
      <div className={styles.field}>
        <span className={styles.prefix}>+1</span>
        <input id="phone" className={styles.input} type="tel" inputMode="tel" autoComplete="tel-national" autoFocus
          placeholder="(555) 000-0000" value={phone} onChange={(ev) => setPhone(formatUs(ev.target.value))} />
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.button} type="submit" disabled={busy || phone.replace(/\D/g, '').length < 10}>{busy ? 'sending\u2026' : 'send code'} <span aria-hidden="true">{"\u2192"}</span></button>
      <p className={styles.fine}>Use the number you text Dinghy from. See our <Link href="/privacy">privacy policy</Link>.</p>
      <p className={styles.divider}>New to Dinghy? It&rsquo;s invite-only for now. <Link href="/#waitlist">Get on the list</Link>, or <a href={DINGHY_SMS}>text Dinghy</a> if you have an invite code.</p>
    </form>
  )
}
