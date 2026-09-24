import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

export default function TermsOfService() {
  return (
    <HarborShell title="Terms of Service" showBack backHref="/">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7, opacity: 0.8 }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.75rem', opacity: 0.5 }}>
          Last updated: September 24, 2026
        </p>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Agreement</h2>
          <p>By using Dinghy you agree to these terms. Dinghy is operated by Biscayne Ventures (&ldquo;we&rdquo;). If you don&rsquo;t agree, don&rsquo;t use it.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>The service</h2>
          <p>Dinghy is an AI assistant you text. It is in early access, may change or stop, and can make mistakes. Check anything important before you rely on it. Dinghy only sends email, invites or other messages on your behalf after you confirm the exact draft, and you are responsible for what you confirm.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Your accounts</h2>
          <p>You may only connect accounts that you own or are allowed to use. You can disconnect them at any time. Keep your phone and chat accounts secure: anyone who can text as you can use your Dinghy.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Acceptable use</h2>
          <p>Don&rsquo;t use Dinghy to break the law, send spam, harass people, or try to access accounts or data that aren&rsquo;t yours. We may suspend access that puts other people or the service at risk.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Privacy</h2>
          <p>How we handle your data, including Google user data, is described in our <Link href="/privacy" style={{ color: 'var(--ink)', fontWeight: 600 }}>privacy policy</Link>.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Disclaimers</h2>
          <p>Dinghy is provided &ldquo;as is&rdquo; without warranties of any kind. To the extent the law allows, we are not liable for indirect or consequential losses, or for actions you confirmed Dinghy to take.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Changes</h2>
          <p>We may update these terms. We&rsquo;ll post changes here with a new date. Continuing to use Dinghy after that means you accept them.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Contact</h2>
          <p>Questions: <a href="mailto:halsey@biscayneventures.xyz" style={{ color: 'var(--ink)', fontWeight: 600 }}>halsey@biscayneventures.xyz</a>.</p>
        </section>
      </div>
    </HarborShell>
  )
}
