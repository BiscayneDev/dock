'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 21) return 'evening'
  return 'night'
}

const GREETINGS: Record<TimeOfDay, string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Good night',
}

const BG_GRADIENTS: Record<TimeOfDay, string> = {
  morning: 'from-sky-100 via-amber-50 to-blue-50',
  afternoon: 'from-sky-100 via-cyan-50 to-blue-100',
  evening: 'from-orange-100 via-rose-50 to-indigo-100',
  night: 'from-slate-800 via-indigo-900 to-slate-900',
}

const TEXT_COLORS: Record<TimeOfDay, { primary: string; secondary: string; card: string; cardBorder: string; cardText: string; cardIcon: string }> = {
  morning: { primary: 'text-slate-800', secondary: 'text-slate-500', card: 'bg-white/70', cardBorder: 'border-slate-200/60', cardText: 'text-slate-600', cardIcon: 'text-slate-700' },
  afternoon: { primary: 'text-slate-800', secondary: 'text-slate-500', card: 'bg-white/70', cardBorder: 'border-slate-200/60', cardText: 'text-slate-600', cardIcon: 'text-slate-700' },
  evening: { primary: 'text-slate-800', secondary: 'text-slate-500', card: 'bg-white/60', cardBorder: 'border-slate-200/50', cardText: 'text-slate-600', cardIcon: 'text-slate-700' },
  night: { primary: 'text-white', secondary: 'text-slate-400', card: 'bg-white/10', cardBorder: 'border-white/10', cardText: 'text-slate-300', cardIcon: 'text-white' },
}

// SVG harbor illustration that renders inline (no external images needed)
function HarborIllustration({ timeOfDay }: { timeOfDay: TimeOfDay }) {
  const isNight = timeOfDay === 'night'
  const skyColor = isNight ? '#1e293b' : timeOfDay === 'evening' ? '#fcd9b6' : '#c5e8f7'
  const waterColor = isNight ? '#1e3a5f' : '#a8d8ea'
  const sandColor = isNight ? '#4a5568' : '#f5e6d0'
  const sunMoonColor = isNight ? '#e2e8f0' : timeOfDay === 'evening' ? '#f97316' : '#fbbf24'

  return (
    <svg viewBox="0 0 400 260" className="w-full max-w-sm mx-auto" aria-hidden="true">
      {/* Sky */}
      <rect width="400" height="260" fill={skyColor} rx="20" />

      {/* Sun/Moon */}
      <circle cx={isNight ? 320 : 300} cy={timeOfDay === 'evening' ? 80 : 60} r={isNight ? 20 : 30} fill={sunMoonColor} opacity={isNight ? 0.9 : 0.8} />
      {isNight && (
        <>
          <circle cx="100" cy="40" r="1.5" fill="white" opacity="0.6" />
          <circle cx="150" cy="25" r="1" fill="white" opacity="0.5" />
          <circle cx="220" cy="35" r="1.5" fill="white" opacity="0.7" />
          <circle cx="270" cy="50" r="1" fill="white" opacity="0.4" />
          <circle cx="60" cy="55" r="1" fill="white" opacity="0.6" />
        </>
      )}

      {/* Distant hills */}
      <path d="M0 160 Q80 100 160 140 Q240 110 320 130 Q360 120 400 140 L400 260 L0 260 Z" fill={isNight ? '#2d3748' : '#b8d4e3'} opacity="0.5" />

      {/* Water */}
      <rect x="0" y="160" width="400" height="100" fill={waterColor} rx="0" />

      {/* Water shimmer lines */}
      <line x1="30" y1="180" x2="90" y2="180" stroke="white" strokeWidth="1" opacity="0.3" />
      <line x1="150" y1="190" x2="220" y2="190" stroke="white" strokeWidth="1" opacity="0.2" />
      <line x1="280" y1="175" x2="350" y2="175" stroke="white" strokeWidth="1" opacity="0.3" />
      <line x1="80" y1="200" x2="140" y2="200" stroke="white" strokeWidth="1" opacity="0.2" />
      <line x1="250" y1="210" x2="310" y2="210" stroke="white" strokeWidth="1" opacity="0.15" />

      {/* Dock/pier */}
      <rect x="160" y="148" width="80" height="8" fill={isNight ? '#4a5568' : '#c4a882'} rx="2" />
      <rect x="165" y="156" width="6" height="20" fill={isNight ? '#4a5568' : '#b8956a'} />
      <rect x="229" y="156" width="6" height="20" fill={isNight ? '#4a5568' : '#b8956a'} />

      {/* Sailboat */}
      <g transform="translate(200, 120)">
        {/* Mast */}
        <line x1="0" y1="-50" x2="0" y2="10" stroke={isNight ? '#a0aec0' : '#8B7355'} strokeWidth="2" />
        {/* Sail */}
        <path d="M2 -45 L2 5 L30 5 Z" fill="white" opacity={isNight ? 0.7 : 0.9} />
        {/* Hull */}
        <path d="M-20 10 Q-15 25 0 25 Q15 25 20 10 Z" fill={isNight ? '#4a5568' : '#2563eb'} />
      </g>

      {/* Lighthouse */}
      <g transform="translate(340, 110)">
        <rect x="-8" y="0" width="16" height="50" fill="white" rx="2" />
        <rect x="-8" y="15" width="16" height="8" fill={isNight ? '#e53e3e' : '#ef4444'} />
        <rect x="-8" y="33" width="16" height="8" fill={isNight ? '#e53e3e' : '#ef4444'} />
        <path d="M-12 0 L0 -12 L12 0 Z" fill={isNight ? '#e53e3e' : '#ef4444'} />
        {/* Light beam */}
        {isNight && (
          <path d="M0 -8 L-40 -30 L-30 -25 Z" fill="#fbbf24" opacity="0.3" />
        )}
      </g>

      {/* Beach/sand */}
      <path d="M0 220 Q100 210 200 215 Q300 210 400 220 L400 260 L0 260 Z" fill={sandColor} opacity="0.6" />

      {/* Anchor icon in sand */}
      <g transform="translate(60, 230)" opacity="0.3">
        <circle cx="0" cy="-8" r="4" fill="none" stroke={isNight ? 'white' : '#64748b'} strokeWidth="1.5" />
        <line x1="0" y1="-4" x2="0" y2="8" stroke={isNight ? 'white' : '#64748b'} strokeWidth="1.5" />
        <path d="M-6 5 Q0 12 6 5" fill="none" stroke={isNight ? 'white' : '#64748b'} strokeWidth="1.5" />
      </g>
    </svg>
  )
}

const QUICK_ACTIONS = [
  { icon: '🤖', label: 'Automations', href: '/dashboard/recipes', span: 1 },
  { icon: '🔌', label: 'Integrations', href: '/onboarding', span: 1 },
  { icon: '📋', label: 'Recipes', href: '/dashboard/recipes/gallery', span: 1 },
  { icon: '📧', label: 'Mail', href: 'https://t.me/heydeckhandbot?text=/briefing', span: 1 },
  { icon: '💬', label: 'Text Dock', href: 'https://t.me/heydeckhandbot', span: 1 },
]

export default function HarborHome() {
  const router = useRouter()
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('afternoon')
  const [dateStr, setDateStr] = useState('')
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    setTimeOfDay(getTimeOfDay())
    setDateStr(new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }))

    // Check if user is authenticated
    fetch('/api/recipes', { credentials: 'include' })
      .then((res) => {
        if (res.ok) {
          setAuthed(true)
        } else {
          router.replace('/')
        }
      })
      .catch(() => router.replace('/'))
  }, [router])

  if (authed === null) {
    return <div className="min-h-screen bg-gradient-to-b from-sky-100 to-blue-50" />
  }

  const colors = TEXT_COLORS[timeOfDay]

  return (
    <div className={`min-h-screen bg-gradient-to-b ${BG_GRADIENTS[timeOfDay]} transition-colors duration-1000`}>
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pt-4 pb-2">
        <span className={`text-lg ${colors.primary}`}>⚓</span>
        <span className={`text-sm font-medium ${colors.secondary}`}>{dateStr}</span>
        <Link href="/dashboard" className={`${colors.secondary} hover:opacity-70 transition-opacity`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </Link>
      </header>

      {/* Hero illustration */}
      <div className="px-6 py-4">
        <HarborIllustration timeOfDay={timeOfDay} />
      </div>

      {/* Greeting */}
      <div className="text-center px-6 pb-2">
        <h1 className={`text-2xl font-semibold tracking-tight ${colors.primary}`}>
          {GREETINGS[timeOfDay]}
        </h1>
        <p className={`mt-1 text-sm ${colors.secondary}`}>
          {timeOfDay === 'morning' && 'ready to chart the course'}
          {timeOfDay === 'afternoon' && 'smooth sailing so far'}
          {timeOfDay === 'evening' && 'wrapping up the watch'}
          {timeOfDay === 'night' && 'anchored for the night'}
        </p>
      </div>

      {/* Quick action cards */}
      <div className="px-5 pt-4 pb-8">
        {/* Top row: 2 cards */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          {QUICK_ACTIONS.slice(0, 2).map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex flex-col items-center justify-center rounded-2xl border ${colors.card} ${colors.cardBorder} backdrop-blur-sm p-5 transition-all active:scale-95 hover:shadow-md`}
            >
              <span className={`text-2xl mb-1.5 ${colors.cardIcon}`}>{action.icon}</span>
              <span className={`text-sm font-medium ${colors.cardText}`}>{action.label}</span>
            </Link>
          ))}
        </div>

        {/* Bottom row: 3 cards */}
        <div className="grid grid-cols-3 gap-3">
          {QUICK_ACTIONS.slice(2).map((action) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex flex-col items-center justify-center rounded-2xl border ${colors.card} ${colors.card} ${colors.cardBorder} backdrop-blur-sm p-4 transition-all active:scale-95 hover:shadow-md`}
            >
              <span className={`text-xl mb-1 ${colors.cardIcon}`}>{action.icon}</span>
              <span className={`text-xs font-medium ${colors.cardText}`}>{action.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom spacer for mobile browsers */}
      <div className="h-8" />
    </div>
  )
}
