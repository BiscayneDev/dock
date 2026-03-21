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

const SUBTEXTS: Record<TimeOfDay, string> = {
  morning: 'ready to chart the course',
  afternoon: 'smooth sailing so far',
  evening: 'wrapping up the watch',
  night: 'anchored for the night',
}

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
    return <div className="min-h-screen bg-gradient-to-b from-[#dce4f0] via-[#c8d6e5] to-[#b8cce0]" />
  }

  return (
    <>
      {/* Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Inter:wght@400;500&display=swap"
        rel="stylesheet"
      />
      {/* Phosphor Icons */}
      <script src="https://unpkg.com/@phosphor-icons/web" async />

      <style>{`
        .hero-mask {
          -webkit-mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to bottom, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%);
        }
        .glass-btn {
          background: rgba(255, 255, 255, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.6);
          box-shadow: 0 4px 24px -6px rgba(0, 0, 0, 0.03), inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        }
        .glass-btn:hover {
          background: rgba(255, 255, 255, 0.55);
        }
        .glass-btn:active {
          transform: scale(0.98);
        }
      `}</style>

      <div className="bg-gray-100 flex items-center justify-center min-h-screen w-full antialiased text-slate-800" style={{ fontFamily: "'Inter', sans-serif" }}>
        <main className="w-full h-full sm:w-[402px] sm:min-h-[874px] bg-gradient-to-b from-[#dce4f0] via-[#c8d6e5] to-[#b8cce0] relative overflow-hidden sm:rounded-[3rem] sm:shadow-2xl sm:border-[8px] sm:border-gray-900 flex flex-col">

          {/* Hero background image */}
          <div className="absolute top-0 left-0 w-full h-[55%] z-0">
            <div
              className="w-full h-full bg-cover bg-center opacity-40 mix-blend-multiply hero-mask"
              style={{ backgroundImage: "url('https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=1000&auto=format&fit=crop')" }}
            />
            <div className="absolute inset-0 bg-[#d6ebfc]/20 hero-mask" />
          </div>

          {/* Header */}
          <header className="flex justify-between items-center px-6 pt-14 pb-4 relative z-10">
            <button className="w-10 h-10 flex items-center justify-start text-slate-700 hover:text-slate-900 transition-colors">
              <i className="ph-fill ph-anchor text-[28px] text-slate-700" />
            </button>

            <div className="text-[15px] font-medium text-slate-500 tracking-wide">
              {dateStr}
            </div>

            <Link
              href="/dashboard"
              className="w-[38px] h-[38px] rounded-full bg-white/60 backdrop-blur-sm border border-white/80 shadow-sm flex items-center justify-center text-slate-400 hover:bg-white/80 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </Link>
          </header>

          {/* Content */}
          <div className="flex-1 flex flex-col relative z-10 mt-32">

            {/* Greeting */}
            <div className="flex flex-col items-center mb-10 px-6">
              <h1
                className="text-[34px] text-slate-800 mb-1 tracking-tight"
                style={{ fontFamily: "'Newsreader', serif" }}
              >
                {GREETINGS[timeOfDay]}
              </h1>
              <p className="text-[15px] text-slate-500 font-medium">
                {SUBTEXTS[timeOfDay]}
              </p>
            </div>

            {/* Action cards */}
            <div className="px-5 flex flex-col gap-[14px] pb-10">

              {/* Top row: 2 cards */}
              <div className="flex gap-[14px]">
                <Link
                  href="/dashboard/recipes"
                  className="glass-btn flex-1 rounded-[32px] pt-6 pb-5 px-4 flex flex-col items-center justify-center gap-3 transition-transform"
                >
                  <i className="ph-fill ph-lightning text-[28px] text-slate-600" />
                  <span className="text-[14px] font-medium text-slate-500">Automations</span>
                </Link>

                <Link
                  href="/onboarding"
                  className="glass-btn flex-1 rounded-[32px] pt-6 pb-5 px-4 flex flex-col items-center justify-center gap-3 transition-transform"
                >
                  <i className="ph-fill ph-plugs-connected text-[28px] text-slate-600" />
                  <span className="text-[14px] font-medium text-slate-500">Integrations</span>
                </Link>
              </div>

              {/* Bottom row: 3 cards */}
              <div className="flex gap-[14px]">
                <Link
                  href="/dashboard/recipes/gallery"
                  className="glass-btn flex-1 rounded-[32px] pt-6 pb-5 px-2 flex flex-col items-center justify-center gap-3 transition-transform"
                >
                  <i className="ph-fill ph-circuitry text-[26px] text-slate-600" />
                  <span className="text-[13px] font-medium text-slate-500">Recipes</span>
                </Link>

                <Link
                  href="https://t.me/heydeckhandbot?text=/briefing"
                  className="glass-btn flex-1 rounded-[32px] pt-6 pb-5 px-2 flex flex-col items-center justify-center gap-3 transition-transform"
                >
                  <i className="ph-fill ph-envelope text-[26px] text-slate-600" />
                  <span className="text-[13px] font-medium text-slate-500">Mail</span>
                </Link>

                <Link
                  href="https://t.me/heydeckhandbot"
                  className="glass-btn flex-1 rounded-[32px] pt-6 pb-5 px-2 flex flex-col items-center justify-center gap-3 transition-transform"
                >
                  <i className="ph-fill ph-chat-teardrop-text text-[26px] text-slate-600" />
                  <span className="text-[13px] font-medium text-slate-500 leading-tight text-center">Text Dock</span>
                </Link>
              </div>

            </div>
          </div>

        </main>
      </div>
    </>
  )
}
