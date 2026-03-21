'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'
import { TelegramLoginButton } from '@/components/TelegramLoginButton'

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

  const handleTelegramAuth = async (data: { id: number; first_name: string; last_name?: string; username?: string; photo_url?: string; auth_date: number; hash: string }) => {
    try {
      const res = await fetch('/api/auth/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'include' })
      if (res.ok) { setAuthenticated(true); await checkIntegrations() }
    } catch { /* Failed */ }
  }

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
      <p style={{ opacity: 0.6, marginBottom: '1.25rem', fontSize: '0.9rem' }}>Connect your services so Dock can manage them.</p>

      {justConnected && (
        <div className="dock-card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--mesh-mint)" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>
          <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem' }}>
            {justConnected.charAt(0).toUpperCase() + justConnected.slice(1)} connected
          </span>
        </div>
      )}

      {!authenticated ? (
        <div className="dock-card" style={{ padding: '2rem', alignItems: 'center' }}>
          <p style={{ marginBottom: '1rem' }}>Sign in with Telegram to get started</p>
          <TelegramLoginButton botName="heydeckhandbot" onAuth={handleTelegramAuth} />
          <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', opacity: 0.5 }}>
            Or send <strong>/start</strong> to <a href="https://t.me/heydeckhandbot" style={{ fontWeight: 700 }}>@heydeckhandbot</a>
          </p>
        </div>
      ) : (
        <>
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
                    <p style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem' }}>OpenWallet</p>
                    <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Crypto wallets</p>
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
