'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NavBar } from '@/components/NavBar'
import { IntegrationCard } from '@/components/IntegrationCard'
import { TelegramLoginButton } from '@/components/TelegramLoginButton'
import { OpenWalletConnect } from '@/components/OpenWalletConnect'

interface ConnectedIntegrations {
  google: boolean
  notion: boolean
  github: boolean
  openwallet: boolean
}

export default function OnboardingPage() {
  const router = useRouter()
  const [authenticated, setAuthenticated] = useState(false)
  const [integrations, setIntegrations] = useState<ConnectedIntegrations>({
    google: false,
    notion: false,
    github: false,
    openwallet: false,
  })
  const [loading, setLoading] = useState(true)

  const checkIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (res.ok) {
        setAuthenticated(true)
        // Check which integrations are connected
        // TODO: Add a dedicated /api/integrations endpoint
        setIntegrations({
          google: false,
          notion: false,
          github: false,
          openwallet: false,
        })
      }
    } catch {
      // Not authenticated
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    checkIntegrations()
  }, [checkIntegrations])

  const handleTelegramAuth = async (data: {
    id: number
    first_name: string
    last_name?: string
    username?: string
    photo_url?: string
    auth_date: number
    hash: string
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
      } else {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        // eslint-disable-next-line no-console
        console.error('Telegram auth failed:', res.status, err)
        alert(`Auth failed: ${err.error ?? res.statusText}`)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Telegram auth error:', err)
      alert('Authentication request failed. Check console for details.')
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const anyConnected = integrations.google || integrations.notion || integrations.github || integrations.openwallet

  if (loading) {
    return (
      <>
        <NavBar />
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-zinc-400">Loading...</p>
        </main>
      </>
    )
  }

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold text-zinc-100">Welcome aboard ⚓</h1>
        <p className="mt-2 text-zinc-400">
          Connect your services so Dock can help you manage them through Telegram.
        </p>

        {!authenticated ? (
          <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-8 text-center">
            <p className="mb-4 text-zinc-300">Sign in with Telegram to get started</p>
            <TelegramLoginButton
              botName="heydeckhandbot"
              onAuth={handleTelegramAuth}
            />
            <div className="mt-6 border-t border-zinc-800 pt-4">
              <p className="text-sm text-zinc-500">
                Widget not working? Send <code className="text-cyan-400">/start</code> to{' '}
                <a href="https://t.me/heydeckhandbot" className="text-cyan-400 hover:underline" target="_blank" rel="noopener noreferrer">
                  @heydeckhandbot
                </a>{' '}
                on Telegram for a magic sign-in link.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-8 space-y-3">
              <IntegrationCard
                name="Google"
                icon="📧"
                description="Gmail and Google Calendar"
                connected={integrations.google}
                connectUrl={`${appUrl}/api/integrations/google/auth`}
              />
              <IntegrationCard
                name="Notion"
                icon="📝"
                description="Pages and databases"
                connected={integrations.notion}
                connectUrl={`${appUrl}/api/integrations/notion/auth`}
              />
              <IntegrationCard
                name="GitHub"
                icon="🐙"
                description="Repos, issues, and PRs"
                connected={integrations.github}
                connectUrl={`${appUrl}/api/integrations/github/auth`}
              />
              <OpenWalletConnect
                connected={integrations.openwallet}
                onConnected={() => setIntegrations({ ...integrations, openwallet: true })}
                onDisconnect={() => setIntegrations({ ...integrations, openwallet: false })}
              />
            </div>

            <div className="mt-8 text-center">
              {anyConnected ? (
                <div className="space-y-4">
                  <p className="text-emerald-400 font-medium">
                    All set! Head back to Telegram to start using Dock.
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <a
                      href="https://t.me/heydeckhandbot"
                      className="inline-flex items-center rounded-lg bg-cyan-600 px-5 py-2.5 font-medium text-white hover:bg-cyan-500 transition-colors"
                    >
                      Back to Telegram
                    </a>
                    <button
                      onClick={() => router.push('/dashboard')}
                      className="inline-flex items-center rounded-lg border border-zinc-700 px-5 py-2.5 font-medium text-zinc-300 hover:border-zinc-500 transition-colors"
                    >
                      Go to Dashboard
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-zinc-500 text-sm">
                  Connect at least one integration to get started.
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </>
  )
}
