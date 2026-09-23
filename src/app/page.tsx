import Link from 'next/link'
import Image from 'next/image'
import { WaitlistSection } from './waitlist-section'
import { Anchor } from '@/components/brand/Scene'

// 24x12 preview of public/hero-coast.jpg, shown while the full image loads.
const HERO_BLUR = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAMABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClo0R85YbuGRDJwsoj4Hsa05vD1jE2HuJFJ7Bc1Q0cu10AZHO1gRlqv3aMt2H86UkuDgtx1rNufNo7FR5eXVXMrWbWC12wWbmQsMuSnQdqKt+IXC3ZHlqfqT/Q0U4ttXZM172h/9k='

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
        .hero { position: relative; min-height: min(100svh, 920px); display: flex; flex-direction: column; overflow: hidden; }
        .hero-bg { position: absolute; inset: 0; z-index: 0; }
        .hero-bg img { object-fit: cover; object-position: 50% 58%; }
        .hero::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none;
          background: linear-gradient(to bottom, rgba(6,11,26,.82) 0%, rgba(6,11,26,.62) 30%, rgba(6,11,26,.18) 56%, rgba(6,11,26,0) 70%, rgba(6,11,26,.35) 88%, var(--abyss) 100%); }
        .hero .wrap { padding-bottom: 96px; }
        .hero h1, .hero .hero-sub { text-shadow: 0 1px 24px rgba(6,11,26,.45); }
        .hero .hero-sub { color: #D3D9E8; }
        .hero-spacer { flex: 1 1 auto; min-height: clamp(160px, 26vw, 320px); }
        h2 { font-size: clamp(24px, 3.4vw, 30px); line-height: 1.15; letter-spacing: -0.015em; }
        .panel { border: 1px solid var(--line); border-radius: 16px; background: var(--deep); padding: 32px 28px; }
        .panel p { color: var(--mist); font-size: 16px; margin-top: 12px; }
        section.block { padding-bottom: 96px; }
        .foot { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px; padding: 32px 0 72px; border-top: 1px solid var(--line); color: var(--fade); font-family: var(--mono); font-weight: 500; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; }
        .foot a { color: var(--mist); } .foot a:hover { color: var(--shell); }
        @media (max-width: 600px) {
          nav.top { padding: 20px 24px; }
          .cta .btn { flex: 1 1 100%; }
          .hero { min-height: 100svh; }
          .hero-bg img { object-position: 54% 60%; }
          .hero::before { background: linear-gradient(to bottom, rgba(6,11,26,.86) 0%, rgba(6,11,26,.7) 42%, rgba(6,11,26,.2) 64%, rgba(6,11,26,0) 76%, rgba(6,11,26,.4) 90%, var(--abyss) 100%); }
          .hero-spacer { min-height: 120px; }
          section.block { padding-bottom: 64px; }
          .panel { padding: 26px 22px; }
          .wl-btn { flex: 1 1 100% !important; }
        }
      `}</style>

      <div style={{ position: 'relative', minHeight: '100vh' }}>
        <header className="hero">
          <div className="hero-bg" aria-hidden="true">
            <Image
              src="/hero-coast.jpg"
              alt=""
              fill
              priority
              sizes="100vw"
              quality={80}
              placeholder="blur"
              blurDataURL={HERO_BLUR}
            />
          </div>
          <nav className="top">
            <span className="mark"><Anchor color="#F2A380" size={20} />dinghy</span>
            <Link href="/onboarding" className="signin">sign in</Link>
          </nav>

          <section className="wrap" style={{ paddingTop: '152px', paddingBottom: 0 }}>
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
          <div className="hero-spacer" />
        </header>

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
