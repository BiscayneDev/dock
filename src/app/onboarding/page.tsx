'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'

interface ConnectedIntegrations { google: boolean; notion: boolean; github: boolean; openwallet: boolean; oura: boolean; whoop: boolean; twitter: boolean }

const INTEGRATIONS = [
  { key: 'google', label: 'Google', desc: 'Gmail and Google Calendar', authPath: '/api/integrations/google/auth', icon: 'M4 7L10.2 11.65C11.27 12.45 12.73 12.45 13.8 11.65L20 7M3 5h18v14H3z' },
  { key: 'notion', label: 'Notion', desc: 'Pages and databases', authPath: '/api/integrations/notion/auth', icon: 'M4 4h16v16H4zM8 4v16M4 8h4M4 12h4' },
  { key: 'github', label: 'GitHub', desc: 'Repos, issues, and PRs', authPath: '/api/integrations/github/auth', icon: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4' },
  { key: 'oura', label: 'Oura Ring', desc: 'Sleep, readiness, and activity', authPath: '/api/integrations/oura/auth', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12z' },
  { key: 'whoop', label: 'WHOOP', desc: 'Recovery, strain, and heart rate', authPath: '/api/integrations/whoop/auth', icon: 'M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z' },
  { key: 'twitter', label: 'Twitter / X', desc: 'Timeline, search, and bookmarks', authPath: '/api/integrations/twitter/auth', icon: 'M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z' },
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
  const [integrations, setIntegrations] = useState<ConnectedIntegrations>({ google: false, notion: false, github: false, openwallet: false, oura: false, whoop: false, twitter: false })
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

      {/* Progress indicator */}
      {authenticated && (() => {
        const connectedCount = Object.values(integrations).filter(Boolean).length
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--ink)', opacity: 0.1 }}>
              <div style={{ width: `${(connectedCount / 7) * 100}%`, height: '100%', borderRadius: 2, background: 'var(--mesh-mint)', transition: 'width 0.3s' }} />
            </div>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.75rem', opacity: 0.6, whiteSpace: 'nowrap' }}>
              {connectedCount} of 7 connected
            </span>
          </div>
        )
      })()}

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
            <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Primary CTA: Workspace */}
              <button
                onClick={() => router.push('/dashboard/recipes/workspace?from=onboarding')}
                className="dock-card"
                style={{
                  padding: '1.5rem',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  backgroundImage: 'linear-gradient(135deg, rgba(91,167,205,0.15) 0%, rgba(148,196,163,0.15) 100%)',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                  </svg>
                  <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>
                    Try the Workspace
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" style={{ marginLeft: 'auto' }}>
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
                <p style={{ fontSize: '0.85rem', opacity: 0.6, lineHeight: 1.5 }}>
                  Test your integrations live, explore x402 APIs, and build your first recipe with the agent.
                </p>
              </button>

              {/* Secondary options */}
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button onClick={() => router.push('/dashboard/recipes/gallery')} className="dock-btn-secondary" style={{ flex: 1 }}>
                  Browse ideas
                </button>
                <a href="https://t.me/heydeckhandbot" className="dock-btn-secondary" style={{ flex: 1, textAlign: 'center', textDecoration: 'none' }}>
                  Back to Telegram
                </a>
              </div>
            </div>
          )}
        </>
      )}
    </HarborShell>
  )
}
