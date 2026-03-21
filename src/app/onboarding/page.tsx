'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface ConnectedIntegrations { google: boolean; notion: boolean; github: boolean; openwallet: boolean }

const INTEGRATIONS = [
  { key: 'google', label: 'Google', desc: 'Gmail and Google Calendar', authPath: '/api/integrations/google/auth', icon: 'M4 7L10.2 11.65C11.27 12.45 12.73 12.45 13.8 11.65L20 7M3 5h18v14H3z' },
  { key: 'notion', label: 'Notion', desc: 'Pages and databases', authPath: '/api/integrations/notion/auth', icon: 'M4 4h16v16H4zM8 4v16M4 8h4M4 12h4' },
  { key: 'github', label: 'GitHub', desc: 'Repos, issues, and PRs', authPath: '/api/integrations/github/auth', icon: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4' },
]

export default function OnboardingPageWrapper() {
  return (
    <Suspense fallback={<HarborShell title="Welcome aboard" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>}>
      <OnboardingPage />
    </Suspense>
  )
}

function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const justConnected = searchParams.get('connected')
  const [authenticated, setAuthenticated] = useState(false)
  const [integrations, setIntegrations] = useState<ConnectedIntegrations>({ google: false, notion: false, github: false, openwallet: false })
  const [loading, setLoading] = useState(true)
  const [owsForm, setOwsForm] = useState({ endpoint: '', apiKey: '' })
  const [owsSaving, setOwsSaving] = useState(false)
  const [owsError, setOwsError] = useState<string | null>(null)
  const [showOws, setShowOws] = useState(false)

  const checkIntegrations = useCallback(async () => {
    try {
      const authRes = await fetch('/api/recipes', { credentials: 'include' })
      if (!authRes.ok) { setLoading(false); return }
      setAuthenticated(true)
      const statusRes = await fetch('/api/integrations/status', { credentials: 'include' })
      if (statusRes.ok) setIntegrations(await statusRes.json())
    } catch { /* Not authenticated */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { checkIntegrations() }, [checkIntegrations])

  const connectOWS = async () => {
    setOwsSaving(true); setOwsError(null)
    try {
      const res = await fetch('/api/integrations/openwallet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(owsForm), credentials: 'include' })
      const data = await res.json()
      if (res.ok) { setIntegrations({ ...integrations, openwallet: true }); setShowOws(false) }
      else setOwsError(data.error ?? 'Connection failed')
    } catch { setOwsError('Connection failed') } finally { setOwsSaving(false) }
  }

  const anyConnected = Object.values(integrations).some(Boolean)

  if (loading) return <HarborShell title="Welcome aboard" showBack><div style={{ paddingTop: '5rem', textAlign: 'center', opacity: 0.5 }}>Loading...</div></HarborShell>

  return (
    <HarborShell title="Welcome aboard" showBack backHref="/harbor">
      {justConnected && (
        <div className="dock-card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mesh-mint)" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem' }}>
            {justConnected.charAt(0).toUpperCase() + justConnected.slice(1)} connected
          </span>
        </div>
      )}

      {!authenticated ? (
        <div className="dock-card" style={{ padding: '2rem 1.5rem', alignItems: 'center', textAlign: 'center' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '1.25rem', opacity: 0.6 }}>
            <path d="M5 21h14M12 21v-12M8 6c1.5 0 4-3 4-3s2.5 3 4 3" />
          </svg>

          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.3rem', marginBottom: '0.75rem', letterSpacing: '-0.02em' }}>
            Get started with Dock
          </h2>

          <div style={{ textAlign: 'left', margin: '0.75rem 0 1.5rem', fontSize: '0.9rem', lineHeight: 1.7, opacity: 0.7 }}>
            <p style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, opacity: 1 }}>1.</span>
              Open <strong>@heydeckhandbot</strong> in Telegram
            </p>
            <p style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, opacity: 1 }}>2.</span>
              Send <strong>/start</strong>
            </p>
            <p style={{ display: 'flex', gap: '0.75rem' }}>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, opacity: 1 }}>3.</span>
              Click the sign-in link you receive
            </p>
          </div>

          <a href="https://t.me/heydeckhandbot" className="dock-btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', fontSize: '0.9rem' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--cream)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.72 8.13c-.13.58-.47.72-.95.45l-2.62-1.93-1.27 1.22c-.14.14-.26.26-.52.26l.18-2.65 4.77-4.31c.21-.18-.04-.29-.32-.1l-5.9 3.71-2.53-.79c-.55-.17-.56-.55.12-.82l9.9-3.82c.46-.17.86.11.7.81z" /></svg>
            Open in Telegram
          </a>
        </div>
      ) : (
        <>
          <p style={{ opacity: 0.6, marginBottom: '1rem', fontSize: '0.9rem' }}>Connect your services so Dock can manage them.</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {INTEGRATIONS.map((int) => {
              const connected = integrations[int.key as keyof ConnectedIntegrations]
              return (
                <div key={int.key} className="dock-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="badge-num">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={int.icon} /></svg>
                    </div>
                    <div>
                      <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>{int.label}</p>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>{int.desc}</p>
                    </div>
                  </div>
                  {connected ? (
                    <span className="meta-text" style={{ color: 'var(--mesh-mint)' }}>Connected</span>
                  ) : (
                    <a href={int.authPath} className="dock-btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Connect</a>
                  )}
                </div>
              )
            })}

            {/* OpenWallet */}
            <div className="dock-card" style={{ padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="badge-num">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div>
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>MoonPay Wallet</p>
                    <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Agent wallet &amp; payments</p>
                  </div>
                </div>
                {integrations.openwallet ? (
                  <span className="meta-text" style={{ color: 'var(--mesh-mint)' }}>Connected</span>
                ) : (
                  <button onClick={() => setShowOws(!showOws)} className="dock-btn-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>Connect</button>
                )}
              </div>
              {showOws && !integrations.openwallet && (
                <div style={{ marginTop: '1rem', borderTop: '1.5px solid var(--ink)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <input type="url" placeholder="Endpoint URL" value={owsForm.endpoint} onChange={(e) => setOwsForm({ ...owsForm, endpoint: e.target.value })} className="dock-input" />
                  <input type="password" placeholder="API Key" value={owsForm.apiKey} onChange={(e) => setOwsForm({ ...owsForm, apiKey: e.target.value })} className="dock-input" />
                  {owsError && <p style={{ fontSize: '0.8rem', color: 'var(--mesh-peach)' }}>{owsError}</p>}
                  <button onClick={connectOWS} disabled={owsSaving || !owsForm.endpoint || !owsForm.apiKey} className="dock-btn-primary">{owsSaving ? 'Connecting...' : 'Connect'}</button>
                </div>
              )}
            </div>
          </div>

          {anyConnected && (
            <div style={{ marginTop: '2rem', textAlign: 'center' }}>
              <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, color: 'var(--mesh-mint)', marginBottom: '0.75rem' }}>All set!</p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
                <a href="https://t.me/heydeckhandbot" className="dock-btn-primary">Back to Telegram</a>
                <button onClick={() => router.push('/harbor')} className="dock-btn-secondary">Go to Harbor</button>
              </div>
            </div>
          )}
        </>
      )}
    </HarborShell>
  )
}
