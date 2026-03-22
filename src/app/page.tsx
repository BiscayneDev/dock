import Link from 'next/link'

const CAPABILITIES = [
  { title: 'Email', desc: 'Search, read, draft, send, and archive emails', icon: 'M4 7L10.2 11.65C11.27 12.45 12.73 12.45 13.8 11.65L20 7M3 5h18v14H3z' },
  { title: 'Calendar', desc: 'View, create, update events and find free time', icon: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z' },
  { title: 'GitHub', desc: 'Track repos, issues, PRs, and notifications', icon: 'M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4' },
  { title: 'Notion', desc: 'Search, read, create, and update pages', icon: 'M4 4h16v16H4zM8 4v16M4 8h4M4 12h4' },
  { title: 'Wallet', desc: 'Check balances, send crypto, sign messages', icon: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z' },
  { title: 'Recipes', desc: 'Automate workflows with triggers and schedules', icon: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
]

export default function LandingPage() {
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
        .landing { font-family: 'Lora', serif; color: var(--ink); -webkit-font-smoothing: antialiased; }
        .landing h1, .landing h2, .landing h3 { font-family: 'Outfit', sans-serif; }
        .hero-mesh {
          position: absolute; inset: 0;
          background:
            radial-gradient(circle at 30% 20%, var(--mesh-cyan) 0%, transparent 40%),
            radial-gradient(circle at 70% 60%, var(--mesh-peach) 0%, transparent 45%),
            radial-gradient(circle at 50% 90%, var(--mesh-mint) 0%, transparent 40%),
            radial-gradient(circle at 80% 10%, var(--mesh-yellow) 0%, transparent 35%);
          background-color: var(--mesh-yellow);
          filter: blur(30px); opacity: 0.7;
          animation: drift 20s ease-in-out infinite alternate;
        }
        @keyframes drift { 0% { transform: scale(1) rotate(0deg); } 100% { transform: scale(1.05) rotate(3deg); } }
        .landing-scallop svg { display: block; width: 100%; height: auto; fill: #d6dce8; }
      `}</style>

      <div className="landing" style={{ backgroundColor: '#d6dce8', minHeight: '100vh' }}>

        {/* Nav */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem 1.5rem', maxWidth: '56rem', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 21h14M12 21v-12M8 6c1.5 0 4-3 4-3s2.5 3 4 3" />
            </svg>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>Dock</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <Link href="/onboarding" style={{
              border: '1.5px solid var(--ink)', borderRadius: '2rem', padding: '0.5rem 1.25rem',
              fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.85rem',
              textDecoration: 'none', color: 'var(--ink)',
            }}>
              Sign in
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section style={{
          position: 'relative', margin: '0 1rem', borderRadius: 'var(--radius-lg)',
          border: '1.5px solid var(--ink)', overflow: 'hidden', minHeight: '380px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          maxWidth: '54rem', marginLeft: 'auto', marginRight: 'auto',
        }}>
          <div className="hero-mesh" />
          <div style={{ position: 'relative', zIndex: 2, padding: '3rem 2rem', maxWidth: '32rem' }}>
            <span style={{
              fontFamily: "'Outfit', sans-serif", fontSize: '0.65rem', textTransform: 'uppercase',
              letterSpacing: '0.05em', fontWeight: 700, opacity: 0.7, display: 'block', marginBottom: '1rem',
            }}>
              AI-Powered Productivity
            </span>
            <h1 style={{
              fontFamily: "'Outfit', sans-serif", fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', marginBottom: '1.25rem',
            }}>
              Your AI first mate,<br />always on deck.
            </h1>
            <p style={{ fontSize: '1.1rem', lineHeight: 1.5, maxWidth: '28rem', opacity: 0.8 }}>
              Dock manages your email, calendar, code, and notes through natural conversation in Telegram. No app switching. Just chat.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', flexWrap: 'wrap' }}>
              <Link href="https://t.me/heydeckhandbot" style={{
                border: '1.5px solid var(--ink)', borderRadius: '2rem', backgroundColor: 'var(--ink)',
                color: 'var(--cream)', padding: '0.75rem 1.5rem',
                fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem',
                textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--cream)" stroke="none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.72 8.13c-.13.58-.47.72-.95.45l-2.62-1.93-1.27 1.22c-.14.14-.26.26-.52.26l.18-2.65 4.77-4.31c.21-.18-.04-.29-.32-.1l-5.9 3.71-2.53-.79c-.55-.17-.56-.55.12-.82l9.9-3.82c.46-.17.86.11.7.81z" /></svg>
                Open in Telegram
              </Link>
              <Link href="/onboarding" style={{
                border: '1.5px solid var(--ink)', borderRadius: '2rem', backgroundColor: 'var(--cream)',
                color: 'var(--ink)', padding: '0.75rem 1.5rem',
                fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.9rem',
                textDecoration: 'none',
              }}>
                Sign in
              </Link>
            </div>
          </div>

          {/* Scallop edge */}
          <div className="landing-scallop" style={{ position: 'absolute', bottom: '-2px', left: 0, width: '100%', zIndex: 1 }}>
            <svg viewBox="0 0 400 40" preserveAspectRatio="none">
              <path d="M0,40 L400,40 L400,15 C370,15 355,35 330,35 C305,35 290,10 265,10 C240,10 225,30 200,30 C175,30 160,5 135,5 C110,5 95,25 70,25 C45,25 30,10 0,10 Z" />
            </svg>
          </div>
        </section>

        {/* Capabilities grid */}
        <section style={{ maxWidth: '54rem', margin: '2rem auto 0', padding: '0 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
            {CAPABILITIES.map((cap, i) => (
              <div key={cap.title} style={{
                border: '1.5px solid var(--ink)', borderRadius: 'var(--radius-lg)',
                backgroundColor: i === 5 ? undefined : 'var(--cream)', padding: '1.25rem',
                display: 'flex', flexDirection: 'column',
                background: i === 5 ? 'linear-gradient(135deg, var(--mesh-peach) 0%, var(--mesh-yellow) 100%)' : 'var(--cream)',
              }}>
                <div style={{
                  width: '28px', height: '28px', border: '1.5px solid var(--ink)', borderRadius: '50%',
                  display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '2rem',
                  fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '0.75rem',
                }}>
                  {i + 1}
                </div>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '0.75rem' }}>
                  <path d={cap.icon} />
                </svg>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-0.02em', marginBottom: '0.35rem' }}>
                  {cap.title}
                </h3>
                <p style={{ fontSize: '0.85rem', lineHeight: 1.4, opacity: 0.7 }}>{cap.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer style={{ maxWidth: '54rem', margin: '3rem auto 0', padding: '2rem 1.5rem', borderTop: '1.5px solid var(--ink)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.75rem', fontWeight: 500, opacity: 0.4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Dock — AI-powered productivity through Telegram
          </p>
          <a href="/privacy" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.7rem', opacity: 0.3, color: 'var(--ink)' }}>Privacy Policy</a>
        </footer>
      </div>
    </>
  )
}
