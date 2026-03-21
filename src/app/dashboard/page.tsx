'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'
import { IntegrationCard } from '@/components/IntegrationCard'
import { OpenWalletConnect } from '@/components/OpenWalletConnect'

interface UserSettings {
  timezone: string
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  daily_briefing: boolean
}

export default function DashboardPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<UserSettings>({
    timezone: 'UTC',
    quiet_hours_start: null,
    quiet_hours_end: null,
    daily_briefing: false,
  })
  const [integrations, setIntegrations] = useState({
    google: false,
    notion: false,
    github: false,
    openwallet: false,
  })
  // TODO: Fetch connected integrations from /api/user/integrations
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (!res.ok) {
        router.push('/onboarding')
        return
      }
      // TODO: Fetch actual user settings and integration status from a dedicated endpoint
      setLoading(false)
    } catch {
      router.push('/onboarding')
    }
  }, [router])

  useEffect(() => {
    loadData()
  }, [loadData])

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (loading) {
    return (
      <>
        <NavBar showDashboard />
        <main className="mx-auto max-w-2xl px-4 py-20 text-center">
          <p className="text-zinc-400">Loading...</p>
        </main>
      </>
    )
  }

  return (
    <>
      <NavBar showDashboard />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>

        {/* Integrations */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200 mb-3">Integrations</h2>
          <div className="space-y-3">
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
        </section>

        {/* Timezone */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200 mb-3">Timezone</h2>
          <select
            value={settings.timezone}
            onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </section>

        {/* Quiet Hours */}
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-zinc-200 mb-3">Quiet Hours</h2>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={settings.quiet_hours_start ?? '22:00'}
              onChange={(e) => setSettings({ ...settings, quiet_hours_start: e.target.value })}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
            />
            <span className="text-zinc-400">to</span>
            <input
              type="time"
              value={settings.quiet_hours_end ?? '08:00'}
              onChange={(e) => setSettings({ ...settings, quiet_hours_end: e.target.value })}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
            />
          </div>
        </section>

        {/* Daily Briefing */}
        <section className="mt-8">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.daily_briefing}
              onChange={(e) => setSettings({ ...settings, daily_briefing: e.target.checked })}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-cyan-500"
            />
            <span className="text-zinc-200">Daily briefing at 8 AM</span>
          </label>
        </section>

        {/* Recipes link */}
        <section className="mt-8">
          <Link
            href="/dashboard/recipes"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-zinc-300 hover:border-zinc-500 transition-colors"
          >
            🤖 Manage Recipes →
          </Link>
        </section>

        {/* Danger zone */}
        <section className="mt-12 rounded-lg border border-red-900/50 p-4">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
          <button className="rounded-md bg-red-900/30 px-4 py-2 text-sm text-red-400 hover:bg-red-900/50 transition-colors">
            Delete Account
          </button>
        </section>
      </main>
    </>
  )
}
