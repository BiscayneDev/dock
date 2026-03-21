'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { HarborScene } from '@/components/HarborScene'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Good evening'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

const QUICK_ACTIONS = [
  {
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 8h18" />
        <path d="M7 4v4" />
        <path d="M11 4v4" />
        <path d="M7 12h2v2H7z" fill="currentColor" stroke="none" />
        <path d="M11 12h2v2h-2z" fill="currentColor" stroke="none" />
      </svg>
    ),
    label: 'Automations',
    href: '/dashboard/recipes',
    span: 1,
  },
  {
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    label: 'Integrations',
    href: '/dashboard',
    span: 1,
  },
  {
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    label: 'Recipes',
    href: '/dashboard/recipes/gallery',
    span: 1,
  },
  {
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="M22 7L12 13 2 7" />
      </svg>
    ),
    label: 'Mail',
    href: 'https://t.me/heydeckhandbot',
    span: 1,
  },
  {
    icon: (
      <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      </svg>
    ),
    label: 'Text Dock',
    href: 'https://t.me/heydeckhandbot',
    span: 1,
  },
]

interface RecipeStats {
  activeCount: number
  totalRuns: number
}

export default function HarborPage() {
  const [greeting, setGreeting] = useState(getGreeting())
  const [date, setDate] = useState(getFormattedDate())
  const [stats, setStats] = useState<RecipeStats | null>(null)

  useEffect(() => {
    setGreeting(getGreeting())
    setDate(getFormattedDate())

    const interval = setInterval(() => {
      setGreeting(getGreeting())
      setDate(getFormattedDate())
    }, 60_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch('/api/recipes', { credentials: 'include' })
        if (res.ok) {
          const recipes = await res.json()
          const active = recipes.filter((r: { enabled: boolean }) => r.enabled).length
          const runs = recipes.reduce((sum: number, r: { run_count?: number }) => sum + (r.run_count || 0), 0)
          setStats({ activeCount: active, totalRuns: runs })
        }
      } catch {
        // silently fail — stats are optional
      }
    }
    fetchStats()
  }, [])

  return (
    <div className="min-h-screen harbor-bg">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pt-4 pb-2">
        <Link href="/" className="harbor-icon-btn">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* Anchor icon */}
            <circle cx="12" cy="5" r="3" />
            <line x1="12" y1="8" x2="12" y2="21" />
            <path d="M5 16Q12 24 19 16" />
            <line x1="9" y1="12" x2="15" y2="12" />
          </svg>
        </Link>

        <span className="text-sm font-medium harbor-date">{date}</span>

        <Link href="/dashboard" className="harbor-icon-btn">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M5 20c0-4 3.5-7 7-7s7 3 7 7" />
          </svg>
        </Link>
      </header>

      {/* Illustration */}
      <div className="px-4 mt-2">
        <div className="harbor-illustration-container">
          <HarborScene />
        </div>
      </div>

      {/* Greeting */}
      <div className="text-center mt-6 px-4">
        <h1 className="text-3xl font-semibold harbor-greeting">{greeting}</h1>
        <p className="mt-1.5 text-sm harbor-subtitle">
          {stats
            ? `${stats.activeCount} active recipe${stats.activeCount !== 1 ? 's' : ''} · ${stats.totalRuns} total run${stats.totalRuns !== 1 ? 's' : ''}`
            : 'Your AI first mate, always on deck'}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="px-5 mt-8 pb-10">
        {/* Top row — 2 cards */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {QUICK_ACTIONS.slice(0, 2).map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="harbor-action-card harbor-action-card-lg"
            >
              <span className="harbor-action-icon">{action.icon}</span>
              <span className="harbor-action-label">{action.label}</span>
            </Link>
          ))}
        </div>
        {/* Bottom row — 3 cards */}
        <div className="grid grid-cols-3 gap-3">
          {QUICK_ACTIONS.slice(2).map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className="harbor-action-card harbor-action-card-sm"
            >
              <span className="harbor-action-icon">{action.icon}</span>
              <span className="harbor-action-label">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
