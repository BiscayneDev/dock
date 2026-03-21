'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { HarborShell } from '@/components/HarborShell'
import { TelegramLoginButton } from '@/components/TelegramLoginButton'

interface ConnectedIntegrations {
  google: boolean
  notion: boolean
  github: boolean
  openwallet: boolean
}

const INTEGRATIONS = [
  { key: 'google', icon: 'ph-google-logo', label: 'Google', desc: 'Gmail and Google Calendar', authPath: '/api/integrations/google/auth' },
  { key: 'notion', icon: 'ph-notepad', label: 'Notion', desc: 'Pages and databases', authPath: '/api/integrations/notion/auth' },
  { key: 'github', icon: 'ph-github-logo', label: 'GitHub', desc: 'Repos, issues, and PRs', authPath: '/api/integrations/github/auth' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [authenticated, setAuthenticated] = useState(false)
  const [integrations, setIntegrations] = useState<ConnectedIntegrations>({
    google: false, notion: false, github: false, openwallet: false,
  })
  const [loading, setLoading] = useState(true)
  const [owsForm, setOwsForm] = useState({ endpoint: '', apiKey: '' })
  const [owsSaving, setOwsSaving] = useState(false)
  const [owsError, setOwsError] = useState<string | null>(null)

  const checkIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (res.ok) {
        setAuthenticated(true)
        setIntegrations({ google: false, notion: false, github: false, openwallet: false })
      }
    } catch { /* Not authenticated */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { checkIntegrations() }, [checkIntegrations])

  const handleTelegramAuth = async (data: {
    id: number; first_name: string; last_name?: string; username?: string;
    photo_url?: string; auth_date: number; hash: string
  }) => {
    try {
      const res = await fetch('/api/auth/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      })
      if (res.ok) {
        setAuthenticated(true)
        await checkIntegrations()
      }
    } catch { /* Failed */ }
  }

  const connectOWS = async () => {
    setOwsSaving(true)
    setOwsError(null)
    try {
      const res = await fetch('/api/integrations/openwallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(owsForm),
        credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) {
        setIntegrations({ ...integrations, openwallet: true })
        setOwsForm({ endpoint: '', apiKey: '' })
      } else {
        setOwsError(data.error ?? 'Connection failed')
      }
    } catch {
      setOwsError('Connection failed')
    } finally {
      setOwsSaving(false)
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const anyConnected = Object.values(integrations).some(Boolean)

  if (loading) {
    return (
      <HarborShell title="Integrations" showBack>
        <div className="pt-20 text-center">
          <p className="text-slate-400">Loading...</p>
        </div>
      </HarborShell>
    )
  }

  return (
    <HarborShell title="Welcome aboard" showBack backHref="/harbor">
      <p className="text-slate-500 text-[15px] mt-1 mb-6">
        Connect your services so Dock can manage them through Telegram.
      </p>

      {!authenticated ? (
        <div className="glass-card rounded-[24px] p-8 text-center">
          <p className="mb-4 text-slate-600">Sign in with Telegram to get started</p>
          <TelegramLoginButton botName="heydeckhandbot" onAuth={handleTelegramAuth} />
          <div className="mt-6 border-t border-white/30 pt-4">
            <p className="text-sm text-slate-400">
              Widget not working? Send <code className="text-blue-500 bg-white/40 px-1 rounded">/start</code> to{' '}
              <a href="https://t.me/heydeckhandbot" className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
                @heydeckhandbot
              </a>{' '}
              for a magic sign-in link.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {INTEGRATIONS.map((int) => (
              <div key={int.key} className="glass-card rounded-[20px] p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center">
                    <i className={`ph-fill ${int.icon} text-[20px] text-slate-600`} />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700 text-[15px]">{int.label}</p>
                    <p className="text-[13px] text-slate-400">{int.desc}</p>
                  </div>
                </div>
                {integrations[int.key as keyof ConnectedIntegrations] ? (
                  <span className="text-[13px] text-emerald-600 font-medium">Connected</span>
                ) : (
                  <a
                    href={`${appUrl}${int.authPath}`}
                    className="px-4 py-2 rounded-full bg-white/60 border border-white/80 text-[13px] font-medium text-slate-600 hover:bg-white/80 transition-colors"
                  >
                    Connect
                  </a>
                )}
              </div>
            ))}

            {/* OpenWallet */}
            <div className="glass-card rounded-[20px] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center">
                    <i className="ph-fill ph-lock-key text-[20px] text-slate-600" />
                  </div>
                  <div>
                    <p className="font-medium text-slate-700 text-[15px]">OpenWallet</p>
                    <p className="text-[13px] text-slate-400">Crypto wallets & transactions</p>
                  </div>
                </div>
                {integrations.openwallet ? (
                  <span className="text-[13px] text-emerald-600 font-medium">Connected</span>
                ) : (
                  <button
                    onClick={() => setOwsForm({ ...owsForm, endpoint: owsForm.endpoint || '' })}
                    className="px-4 py-2 rounded-full bg-white/60 border border-white/80 text-[13px] font-medium text-slate-600 hover:bg-white/80 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
              {!integrations.openwallet && owsForm.endpoint !== undefined && (
                <div className="mt-4 pt-3 border-t border-white/30 space-y-2">
                  <input
                    type="url" placeholder="Endpoint URL" value={owsForm.endpoint}
                    onChange={(e) => setOwsForm({ ...owsForm, endpoint: e.target.value })}
                    className="glass-input w-full rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
                  />
                  <input
                    type="password" placeholder="API Key" value={owsForm.apiKey}
                    onChange={(e) => setOwsForm({ ...owsForm, apiKey: e.target.value })}
                    className="glass-input w-full rounded-xl px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
                  />
                  {owsError && <p className="text-sm text-red-500">{owsError}</p>}
                  <button
                    onClick={connectOWS} disabled={owsSaving || !owsForm.endpoint || !owsForm.apiKey}
                    className="w-full py-2 rounded-xl bg-white/60 border border-white/80 text-[13px] font-medium text-slate-600 hover:bg-white/80 transition-colors disabled:opacity-50"
                  >
                    {owsSaving ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {anyConnected && (
            <div className="mt-8 text-center space-y-3">
              <p className="text-emerald-600 font-medium text-[15px]">All set! Head back to Telegram.</p>
              <div className="flex justify-center gap-3">
                <a
                  href="https://t.me/heydeckhandbot"
                  className="px-5 py-2.5 rounded-full bg-slate-800 text-white text-[14px] font-medium hover:bg-slate-700 transition-colors"
                >
                  Back to Telegram
                </a>
                <button
                  onClick={() => router.push('/harbor')}
                  className="px-5 py-2.5 rounded-full bg-white/60 border border-white/80 text-[14px] font-medium text-slate-600 hover:bg-white/80 transition-colors"
                >
                  Go to Harbor
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </HarborShell>
  )
}
