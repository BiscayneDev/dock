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
  morning: 'Good morning,',
  afternoon: 'Good afternoon,',
  evening: 'Good evening,',
  night: 'Good night,',
}

const WEATHER_TEXT: Record<TimeOfDay, string> = {
  morning: 'Fresh winds ahead. Let\'s chart the course for today.',
  afternoon: 'Smooth sailing so far. Stay the course.',
  evening: 'The watch is winding down. Time to drop anchor.',
  night: 'All quiet in the harbor. Rest easy, Captain.',
}

export default function HarborHome() {
  const router = useRouter()
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>('afternoon')
  const [dateStr, setDateStr] = useState('')
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    setTimeOfDay(getTimeOfDay())
    setDateStr(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))

    fetch('/api/recipes', { credentials: 'include' })
      .then((res) => { if (res.ok) setAuthed(true); else router.replace('/') })
      .catch(() => router.replace('/'))
  }, [router])

  if (authed === null) {
    return <div style={{ minHeight: '100vh', backgroundColor: '#d6dce8' }} />
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=Outfit:wght@400;500;700;800&display=swap" rel="stylesheet" />

      <style>{`
        :root {
          --cream: #EAE6D7;
          --ink: #102A22;
          --border-w: 1.5px;
          --radius-lg: 1.75rem;
          --mesh-cyan: #5BA7CD;
          --mesh-yellow: #E8D368;
          --mesh-peach: #E48D6C;
          --mesh-mint: #94C4A3;
        }
        .harbor-page { font-family: 'Lora', serif; color: var(--ink); -webkit-font-smoothing: antialiased; background: #d6dce8; min-height: 100vh; }
        .harbor-page h1, .harbor-page h2, .harbor-page h3, .harbor-page .font-sans {
          font-family: 'Outfit', sans-serif; color: var(--ink);
        }
        .meta-text {
          font-family: 'Outfit', sans-serif; font-size: 0.65rem; text-transform: uppercase;
          letter-spacing: 0.05em; font-weight: 700; opacity: 0.8;
        }
        .hero-bg-mesh {
          position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
          background:
            radial-gradient(circle at 50% 0%, var(--mesh-cyan) 0%, transparent 40%),
            radial-gradient(circle at 80% 40%, var(--mesh-peach) 0%, transparent 50%),
            radial-gradient(circle at 20% 60%, var(--mesh-mint) 0%, transparent 50%),
            radial-gradient(circle at 60% 80%, var(--mesh-yellow) 0%, transparent 40%);
          background-color: var(--mesh-yellow);
          animation: breathe 15s ease-in-out infinite alternate;
          z-index: 1; filter: blur(20px);
        }
        @keyframes breathe { 0% { transform: scale(1) rotate(0deg); } 100% { transform: scale(1.1) rotate(5deg); } }
        .hero-scallop svg { display: block; width: 100%; height: auto; fill: #d6dce8; }
        .card-gradient { background: linear-gradient(135deg, var(--mesh-peach) 0%, var(--mesh-yellow) 100%) !important; }
        .illust-blob {
          position: absolute; right: -10%; top: 10%; width: 150px; height: 120px;
          background: radial-gradient(circle, var(--mesh-mint) 0%, transparent 70%);
          filter: blur(10px); opacity: 0.8; border-radius: 50%;
        }
        .dock-card {
          border: var(--border-w) solid var(--ink); border-radius: var(--radius-lg);
          background-color: var(--cream); padding: 1.25rem; position: relative;
          display: flex; flex-direction: column; text-decoration: none; color: var(--ink); overflow: hidden;
          transition: transform 0.1s;
        }
        .dock-card:active { transform: scale(0.98); }
        .badge-num {
          position: absolute; top: 1.25rem; left: 1.25rem; width: 24px; height: 24px;
          border: var(--border-w) solid var(--ink); border-radius: 50%;
          display: flex; justify-content: center; align-items: center;
          font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 0.75rem; z-index: 2;
        }
        .card-title {
          font-family: 'Outfit', sans-serif; font-size: 1.25rem; font-weight: 700;
          line-height: 1.2; letter-spacing: -0.02em; margin-top: 2.5rem; margin-bottom: 0.5rem; z-index: 2;
        }
        .card-desc { font-size: 0.85rem; line-height: 1.4; opacity: 0.8; z-index: 2; margin-top: auto; }
        .card-icon {
          margin-top: 2rem; margin-bottom: auto; width: 28px; height: 28px;
          stroke: var(--ink); stroke-width: var(--border-w); fill: none;
          stroke-linecap: round; stroke-linejoin: round;
        }
      `}</style>

      <div className="harbor-page">
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', maxWidth: '56rem', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 21h14M12 21v-12M8 6c1.5 0 4-3 4-3s2.5 3 4 3" />
            </svg>
            <span className="font-sans" style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.02em' }}>Dock</span>
          </div>
          <div style={{ fontStyle: 'italic', fontSize: '0.9rem', fontWeight: 500, opacity: 0.6 }}>{dateStr}</div>
          <Link href="/dashboard" style={{
            width: '32px', height: '32px', border: '1.5px solid var(--ink)', borderRadius: '50%',
            display: 'flex', justifyContent: 'center', alignItems: 'center', backgroundColor: 'var(--cream)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          </Link>
        </header>

        <div style={{ maxWidth: '56rem', margin: '0 auto', padding: '0 1rem' }}>
          {/* Hero */}
          <section style={{
            position: 'relative', border: '1.5px solid var(--ink)',
            borderRadius: 'var(--radius-lg)', overflow: 'hidden', backgroundColor: 'var(--mesh-yellow)',
            minHeight: '280px', display: 'flex', flexDirection: 'column', marginBottom: '1rem',
          }}>
            <div className="hero-bg-mesh" />
            <div style={{ position: 'relative', zIndex: 3, padding: '2.5rem 2rem', flexGrow: 1 }}>
              <span className="meta-text" style={{ display: 'block', marginBottom: '1rem' }}>Daily Brief</span>
              <h1 style={{ fontSize: 'clamp(2rem, 4vw, 2.5rem)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '1rem' }}>
                {GREETINGS[timeOfDay]}<br />Captain.
              </h1>
              <p style={{ fontSize: '1.1rem', lineHeight: 1.4, maxWidth: '24rem', opacity: 0.8 }}>{WEATHER_TEXT[timeOfDay]}</p>
            </div>
            <div className="hero-scallop" style={{ position: 'absolute', bottom: '-2px', left: 0, width: '100%', zIndex: 2 }}>
              <svg viewBox="0 0 400 60" preserveAspectRatio="none">
                <path d="M0,60 L400,60 L400,20 C370,20 350,45 320,45 C290,45 280,15 250,15 C220,15 200,40 170,40 C140,40 120,5 90,5 C60,5 30,35 0,35 Z" />
              </svg>
            </div>
            <Link href="/dashboard/recipes/new" style={{
              position: 'absolute', bottom: '1.5rem', right: '1.5rem', width: '36px', height: '36px',
              border: '1.5px solid var(--ink)', borderRadius: '50%', background: 'var(--cream)',
              display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 4,
            }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </Link>
          </section>

          {/* Top row — two hero cards */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', paddingBottom: '0.75rem' }}>
            {/* Automations */}
            <Link href="/dashboard/recipes" className="dock-card" style={{ position: 'relative' }}>
              <div className="badge-num">1</div>
              <div style={{ position: 'absolute', top: 0, right: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
                <div className="illust-blob" />
                <svg style={{ position: 'absolute', right: 10, bottom: 10, width: 80, height: 60 }} viewBox="0 0 100 80" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 60 Q20 50 30 60 T50 60 T70 60 T90 60" opacity="0.5" />
                  <path d="M0 70 Q15 65 30 70 T60 70 T90 70 T100 65" />
                </svg>
              </div>
              <h2 className="card-title">Automations</h2>
              <p className="card-desc">Your active workflows</p>
            </Link>

            {/* Idea Workspace */}
            <Link href="/dashboard/recipes/workspace" className="dock-card" style={{ backgroundImage: 'linear-gradient(135deg, rgba(91,167,205,0.2) 0%, rgba(148,196,163,0.2) 100%)' }}>
              <div className="badge-num">2</div>
              <svg className="card-icon" viewBox="0 0 24 24"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
              <h2 className="card-title">Idea Workspace</h2>
              <p className="card-desc">Test ideas live &amp; build recipes</p>
            </Link>
          </section>

          {/* Bottom row — four cards */}
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem', paddingBottom: '2rem' }}>
            {/* Integrate */}
            <Link href="/onboarding" className="dock-card">
              <div className="badge-num">3</div>
              <svg className="card-icon" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><circle cx="17" cy="17" r="3" /></svg>
              <h2 className="card-title">Integrate</h2>
              <p className="card-desc">Connect tools</p>
            </Link>

            {/* Recipes */}
            <Link href="/dashboard/recipes/gallery" className="dock-card card-gradient">
              <div className="badge-num">4</div>
              <svg className="card-icon" viewBox="0 0 24 24"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
              <h2 className="card-title">Recipes</h2>
              <p className="card-desc">Marketplace</p>
            </Link>

            {/* Mail */}
            <Link href="https://t.me/heydeckhandbot?text=/briefing" className="dock-card">
              <div className="badge-num">5</div>
              <svg className="card-icon" viewBox="0 0 24 24"><path d="M4 7.00005L10.2 11.65C11.2667 12.45 12.7333 12.45 13.8 11.65L20 7" /><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
              <h2 className="card-title">Mail</h2>
              <p className="card-desc">Dispatches</p>
            </Link>

            {/* Telegram */}
            <Link href="https://t.me/heydeckhandbot" className="dock-card">
              <div className="badge-num">6</div>
              <svg className="card-icon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
              <h2 className="card-title">Telegram</h2>
              <p className="card-desc">Chat with Dock</p>
            </Link>
          </section>
        </div>
      </div>
    </>
  )
}
