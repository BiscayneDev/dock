import Link from 'next/link'
import { WaitlistSection } from './waitlist-section'

export default function LandingPage() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400;1,600&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      <style>{`
        :root {
          --night: #050a18;
          --deep: #0a1226;
          --mist: #b9c9de;
          --fade: #8fa3bd;
          --blue: #6b9ce0;
          --serif: "Playfair Display", Georgia, serif;
          --sans: "Inter", -apple-system, sans-serif;
          --mono: "JetBrains Mono", ui-monospace, monospace;
        }
        * { box-sizing: border-box; margin: 0; }
        body { background: var(--night); color: #e8eef6; font: 16px/1.7 var(--sans); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        a { color: inherit; text-decoration: none; }
        .wrap { max-width: 640px; margin: 0 auto; padding: 0 26px; position: relative; z-index: 5; }
        .kicker { font-family: var(--mono); font-size: 11px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--blue); margin-bottom: 22px; }
        .kicker::before { content: ""; display: inline-block; width: 34px; height: 1px; background: var(--fade); vertical-align: middle; margin-right: 14px; }
        h1 { font-family: var(--serif); font-weight: 600; font-size: clamp(38px, 7vw, 64px); line-height: 1.02; letter-spacing: -0.015em; max-width: 16ch; }
        h1 em { font-style: italic; font-weight: 400; color: var(--blue); }
        .hero-sub { font-size: 17px; color: var(--mist); max-width: 460px; margin-top: 28px; font-weight: 400; line-height: 1.6; }
        .hero-sub b { color: #fff; font-weight: 500; }
        .cta { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 36px; }
        .cta a {
          font-family: var(--mono); font-size: 12.5px; letter-spacing: 0.18em;
          text-transform: uppercase; padding: 14px 28px; border-radius: 999px;
          transition: background .3s ease, transform .3s ease, border-color .3s ease;
        }
        .cta .primary { color: #071222; background: #cfe0f2; }
        .cta .primary:hover { background: #fff; transform: translateY(-2px); }
        .cta .quiet { color: var(--fade); border: 1px solid rgba(110,130,156,0.25); }
        .cta .quiet:hover { color: #fff; border-color: #fff; }
        .sec-k { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--blue); margin-bottom: 20px; }
        .sec-k::before { content: ""; display: inline-block; width: 34px; height: 1px; background: var(--fade); vertical-align: middle; margin-right: 14px; }
        h2 { font-family: var(--serif); font-weight: 600; font-size: clamp(28px, 4vw, 38px); line-height: 1.1; letter-spacing: -0.01em; margin-bottom: 18px; }
        h2 em { font-style: italic; font-weight: 400; color: var(--blue); }
        section p { color: var(--mist); max-width: 52ch; font-size: 15.5px; margin-bottom: 18px; line-height: 1.65; }
        section p b { color: #fff; font-weight: 500; }
        .panel { border: 1px solid rgba(110,130,156,0.18); border-radius: 14px; background: rgba(10,18,38,0.5); padding: 28px 24px; }
        footer { padding: 44px 0 70px; border-top: 1px solid rgba(110,130,156,0.14); color: var(--fade); font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.14em; text-transform: uppercase; }
        footer a { color: var(--mist); }
        footer a:hover { color: #fff; }
      `}</style>

      <div style={{ position: 'relative', minHeight: '100vh' }}>

        {/* Nav */}
        <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 34px', mixBlendMode: 'screen' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', letterSpacing: '0.24em', textTransform: 'uppercase', color: '#cdd9e8' }}>dinghy</span>
          <div style={{ display: 'flex', gap: '26px' }}>
            <Link href="/onboarding" style={{ fontFamily: 'var(--mono)', fontSize: '11.5px', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--fade)' }}>sign in</Link>
          </div>
        </nav>

        {/* Hero */}
        <section className="wrap" style={{ paddingTop: '140px', paddingBottom: '80px' }}>
          <div className="kicker">your first mate lives in your texts</div>
          <h1>your first mate lives in <em>your texts</em></h1>
          <p className="hero-sub">
            dinghy is a first mate that lives in imessage. you text it like a person. <b>it does the work.</b>
          </p>
          <div className="cta">
            <Link href="/onboarding" className="primary">join the beta →</Link>
            <a href="#waitlist" className="quiet">get on the list</a>
          </div>
        </section>

        {/* How it's built */}
        <section className="wrap" style={{ paddingBottom: '80px' }}>
          <div className="sec-k">how it&apos;s built</div>
          <div className="panel">
            <h2 style={{ fontSize: 'clamp(22px, 3vw, 28px)', marginBottom: '14px' }}>
              shipyard picks the model, <em>dock</em> runs the agent, <em>paybox</em> holds the keys.
            </h2>
            <p style={{ marginBottom: 0 }}>you just text.</p>
          </div>
        </section>

        {/* Private Beta — Waitlist */}
        <section className="wrap" id="waitlist" style={{ paddingBottom: '80px', scrollMarginTop: '120px' }}>
          <div className="sec-k">private beta</div>
          <div className="panel" style={{ textAlign: 'center' }}>
            <p style={{ maxWidth: '30ch', margin: '0 auto 28px' }}>
              dinghy is in private beta. leave your email and i&apos;ll text you when a seat opens.
            </p>
            <WaitlistSection />
          </div>
        </section>

        {/* Footer */}
        <footer className="wrap">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <span>dinghy · a shipyard product</span>
            <div style={{ display: 'flex', gap: '20px' }}>
              <Link href="/privacy">privacy</Link>
              <a href="https://openshipyard.xyz">shipyard</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}
