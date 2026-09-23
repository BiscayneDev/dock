import Link from 'next/link'
import { WaitlistSection } from './waitlist-section'
import { Anchor, FirstLight } from '@/components/brand/Scene'

export default function LandingPage() {
  return (
    <>
      <style>{`
        body {
          --abyss: #060B1A;
          --deep: #0C1530;
          --line: rgba(200,210,235,0.12);
          --shell: #F3EDE3;
          --mist: #B7C0D6;
          --fade: #8290AE;
          --ember: #F2A380;
          --serif: var(--font-fraunces), Georgia, serif;
          --sans: var(--font-schibsted), -apple-system, sans-serif;
          --mono: var(--font-dmmono), ui-monospace, monospace;
        }
        * { box-sizing: border-box; margin: 0; }
        body { background: var(--abyss); color: var(--shell); font: 17px/1.6 var(--sans); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        a { color: inherit; text-decoration: none; }
        .wrap { max-width: 688px; margin: 0 auto; padding: 0 24px; position: relative; z-index: 5; }
        .serif { font-family: var(--serif); font-weight: 520; font-variation-settings: 'SOFT' 100, 'WONK' 0; }
        em { font-family: var(--serif); font-style: italic; font-weight: 400; font-variation-settings: 'SOFT' 100, 'WONK' 1; color: var(--ember); }
        .label { display: flex; align-items: center; gap: 12px; font-family: var(--mono); font-weight: 500; font-size: 11px; line-height: 1; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ember); white-space: nowrap; margin-bottom: 24px; }
        .label::before { content: ""; width: 28px; height: 1px; background: currentColor; opacity: .6; flex: none; }
        nav.top { position: absolute; top: 0; left: 0; right: 0; z-index: 30; display: flex; justify-content: space-between; align-items: center; padding: 24px 32px; }
        .mark { display: flex; align-items: center; gap: 10px; font-family: var(--mono); font-weight: 500; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--shell); }
        .signin { font-family: var(--sans); font-size: 15px; color: var(--mist); transition: color .2s ease; }
        .signin:hover { color: var(--shell); }
        h1 { font-size: clamp(44px, 8vw, 72px); line-height: 1; letter-spacing: -0.025em; max-width: 14ch; }
        .hero-sub { font-size: 17px; color: var(--mist); max-width: 30em; margin-top: 24px; }
        .hero-sub b { color: var(--shell); font-weight: 500; }
        .cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 40px; }
        .btn { display: inline-flex; align-items: center; justify-content: center; height: 48px; padding: 0 26px; border-radius: 999px; font-family: var(--sans); font-weight: 500; font-size: 15px; white-space: nowrap; transition: background .2s ease, box-shadow .2s ease, color .2s ease, transform .2s ease; }
        .btn.primary { background: #F6EFE4; color: var(--abyss); }
        .btn.primary:hover { background: #fff; transform: translateY(-1px); }
        .btn.quiet { box-shadow: inset 0 0 0 1px rgba(183,192,214,.35); color: var(--shell); }
        .btn.quiet:hover { box-shadow: inset 0 0 0 1px var(--shell); }
        .horizon { position: relative; height: clamp(220px, 34vw, 400px); margin: 24px 0 96px; }
        .horizon > div, .horizon svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
        .horizon::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 45%; z-index: 1; background: linear-gradient(to top, rgba(6,11,26,0), var(--abyss)); }
        .horizon::after { content: ""; position: absolute; inset: auto 0 0 0; height: 16%; z-index: 1; background: linear-gradient(to bottom, rgba(6,11,26,0), var(--abyss)); }
        h2 { font-size: clamp(24px, 3.4vw, 30px); line-height: 1.15; letter-spacing: -0.015em; }
        .panel { border: 1px solid var(--line); border-radius: 16px; background: var(--deep); padding: 32px 28px; }
        .panel p { color: var(--mist); font-size: 16px; margin-top: 12px; }
        section.block { padding-bottom: 96px; }
        .foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 32px 0 72px; border-top: 1px solid var(--line); color: var(--fade); font-family: var(--mono); font-weight: 500; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; }
        .foot a { color: var(--mist); } .foot a:hover { color: var(--shell); }
        @media (max-width: 600px) {
          nav.top { padding: 20px 24px; }
          .cta .btn { flex: 1 1 100%; }
          .horizon { margin-bottom: 64px; }
          section.block { padding-bottom: 64px; }
          .panel { padding: 26px 22px; }
          .wl-btn { flex: 1 1 100% !important; }
        }
      `}</style>

      <div style={{ position: 'relative', minHeight: '100vh' }}>
        <nav className="top">
          <span className="mark"><Anchor color="#F2A380" size={20} />dinghy</span>
          <Link href="/onboarding" className="signin">sign in</Link>
        </nav>

        <section className="wrap" style={{ paddingTop: '152px' }}>
          <div className="label">private beta · imessage</div>
          <h1 className="serif">your first mate lives in <em>your texts</em></h1>
          <p className="hero-sub">
            dinghy is a first mate that lives in imessage. you text it like a person. <b>it does the work.</b>
          </p>
          <div className="cta">
            <Link href="/onboarding" className="btn primary">join the beta</Link>
            <a href="#waitlist" className="btn quiet">get on the list</a>
          </div>
        </section>

        <div className="horizon" aria-hidden="true">
          <FirstLight id="home" boatX={820} horizon={440} />
        </div>

        <section className="wrap block">
          <div className="label">how it&apos;s built</div>
          <div className="panel">
            <h2 className="serif">shipyard picks the model, <em>dock</em> runs the agent, <em>paybox</em> holds the keys.</h2>
            <p>you just text.</p>
          </div>
        </section>

        <section className="wrap block" id="waitlist" style={{ scrollMarginTop: '96px' }}>
          <div className="label">private beta</div>
          <div className="panel">
            <h2 className="serif">get a seat on the <em>boat</em></h2>
            <p style={{ marginBottom: '24px' }}>
              dinghy is in private beta. leave your email and i&apos;ll text you when a seat opens.
            </p>
            <WaitlistSection />
          </div>
        </section>

        <footer className="wrap">
          <div className="foot">
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
