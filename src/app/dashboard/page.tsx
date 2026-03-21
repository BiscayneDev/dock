'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

export default function DashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [timezone, setTimezone] = useState('UTC')
  const [quietStart, setQuietStart] = useState('22:00')
  const [quietEnd, setQuietEnd] = useState('08:00')
  const [dailyBriefing, setDailyBriefing] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/recipes', { credentials: 'include' })
      if (!res.ok) { router.push('/onboarding'); return }
      setLoading(false)
    } catch { router.push('/onboarding') }
  }, [router])

  useEffect(() => { loadData() }, [loadData])

  if (loading) {
    return <HarborShell title="Settings" showBack><div className="pt-20 text-center text-slate-400">Loading...</div></HarborShell>
  }

  return (
    <HarborShell title="Settings" showBack>
      <div className="space-y-5 mt-4">

        {/* Quick links */}
        <div className="flex gap-3">
          <Link href="/dashboard/recipes" className="glass-card glass-card-hover flex-1 rounded-[20px] p-4 flex flex-col items-center gap-2 transition-transform">
            <i className="ph-fill ph-lightning text-[22px] text-slate-600" />
            <span className="text-[13px] font-medium text-slate-500">Recipes</span>
          </Link>
          <Link href="/dashboard/integrations" className="glass-card glass-card-hover flex-1 rounded-[20px] p-4 flex flex-col items-center gap-2 transition-transform">
            <i className="ph-fill ph-plugs-connected text-[22px] text-slate-600" />
            <span className="text-[13px] font-medium text-slate-500">MCP Servers</span>
          </Link>
          <Link href="/onboarding" className="glass-card glass-card-hover flex-1 rounded-[20px] p-4 flex flex-col items-center gap-2 transition-transform">
            <i className="ph-fill ph-link text-[22px] text-slate-600" />
            <span className="text-[13px] font-medium text-slate-500">Connect</span>
          </Link>
        </div>

        {/* Timezone */}
        <div className="glass-card rounded-[20px] p-5">
          <h2 className="text-[15px] font-semibold text-slate-700 mb-3" style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }}>Timezone</h2>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="glass-input w-full rounded-xl px-3 py-2.5 text-sm text-slate-700"
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        {/* Quiet Hours */}
        <div className="glass-card rounded-[20px] p-5">
          <h2 className="text-slate-700 mb-3" style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }}>Quiet Hours</h2>
          <div className="flex items-center gap-3">
            <input
              type="time" value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
              className="glass-input rounded-xl px-3 py-2 text-sm text-slate-700"
            />
            <span className="text-slate-400 text-sm">to</span>
            <input
              type="time" value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
              className="glass-input rounded-xl px-3 py-2 text-sm text-slate-700"
            />
          </div>
        </div>

        {/* Daily Briefing */}
        <div className="glass-card rounded-[20px] p-5">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-slate-700" style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }}>Daily Briefing</p>
              <p className="text-[13px] text-slate-400 mt-0.5">Calendar + email snapshot at 8 AM</p>
            </div>
            <button
              onClick={() => setDailyBriefing(!dailyBriefing)}
              className={`relative w-12 h-7 rounded-full transition-colors ${dailyBriefing ? 'bg-emerald-400' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${dailyBriefing ? 'translate-x-5' : ''}`} />
            </button>
          </label>
        </div>

        {/* Danger zone */}
        <div className="glass-card rounded-[20px] p-5 border-red-200/50">
          <h2 className="text-red-500 mb-2" style={{ fontFamily: "'Newsreader', serif", fontSize: '18px' }}>Danger Zone</h2>
          <button className="px-4 py-2 rounded-xl bg-red-50/50 border border-red-200/50 text-sm text-red-500 hover:bg-red-100/50 transition-colors">
            Delete Account
          </button>
        </div>
      </div>
    </HarborShell>
  )
}
