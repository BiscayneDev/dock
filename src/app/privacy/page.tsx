import Link from 'next/link'
import { HarborShell } from '@/components/HarborShell'

export default function PrivacyPolicy() {
  return (
    <HarborShell title="Privacy Policy" showBack backHref="/">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7, opacity: 0.8 }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.75rem', opacity: 0.5 }}>
          Last updated: September 24, 2026
        </p>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>What Dinghy is</h2>
          <p>Dinghy is an AI assistant you text over iMessage (and, for older accounts, Telegram). When you connect accounts, it can read and summarize your email and calendar, draft emails and events, and send or create them only after you confirm. Dinghy is operated by Biscayne Ventures (&ldquo;we&rdquo;). Web pages at getdinghy.sh let you connect accounts and read this policy.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Information we collect</h2>
          <p><strong>Your chat identity:</strong> the phone number or Apple ID handle you text Dinghy from (or your Telegram ID), your name if you give it, and your timezone.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Messages:</strong> your conversation with Dinghy, so it can keep context. Dinghy may also save short notes it learns about you (for example preferences you tell it) so it can help later.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Connected account tokens:</strong> when you connect Google, GitHub, Oura, WHOOP or PayBox, we store OAuth access and refresh tokens, encrypted with AES-256-GCM, plus the email address of each connected Google account.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Files and reminders</strong> you ask Dinghy to create.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Google user data</h2>
          <p>If you connect a Google account, Dinghy asks for these permissions:</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li><strong>Gmail read</strong> - to search, read and summarize your email when you ask, and for your morning briefing</li>
            <li><strong>Gmail send</strong> - to send an email or reply you have seen and confirmed</li>
            <li><strong>Gmail modify</strong> - to label, archive or mark messages read when you ask</li>
            <li><strong>Calendar</strong> - to read your events and to create or update events you ask for</li>
            <li><strong>Basic profile (email address)</strong> - to know which Google account is connected</li>
          </ul>
          <p style={{ marginTop: '0.5rem' }}><strong>How we use it:</strong> only to provide the features you use in Dinghy, at your request or on a schedule you turned on (like the morning briefing). Dinghy never sends email or calendar invites without showing you the exact draft and getting your yes first.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>What we store:</strong> your encrypted tokens and the account email. Email and calendar content is fetched when needed to answer you. Dinghy&rsquo;s replies to you (which may quote or summarize that content) are kept in your conversation history. We do not keep a separate copy of your mailbox or calendar.</p>
          <p style={{ marginTop: '0.5rem' }}><strong>Who sees it:</strong> to answer you, the relevant email or calendar content is processed by the AI model provider behind Dinghy (currently Anthropic, through our own inference gateway). It is used only to generate your reply. We do not sell Google user data, do not use it for advertising, and do not use it to train AI models, ours or anyone else&rsquo;s. People at Biscayne Ventures do not read your Google data, except with your permission, when needed for security or to investigate abuse, or to comply with the law.</p>
          <p style={{ marginTop: '0.5rem' }}>Dinghy&rsquo;s use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: 'var(--ink)', fontWeight: 600 }}>Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Service providers</h2>
          <p>We use these providers to run Dinghy. Each handles data only to provide its service to us:</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li>Supabase - database (encrypted tokens, conversation history)</li>
            <li>Vercel - hosting</li>
            <li>Anthropic (via the Shipyard inference gateway) - AI model processing</li>
            <li>Photon / Spectrum - iMessage delivery</li>
            <li>E2B - the sandboxed computer Dinghy uses when you ask it to run code or browse</li>
            <li>Telegram - messaging, for Telegram users</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Security</h2>
          <p>OAuth tokens are encrypted at rest with AES-256-GCM. Connect links are single-use and expire. Access to production systems is limited to the people who run Dinghy.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Retention and deletion</h2>
          <p>We keep your data while your account is active.</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li>Disconnect a Google account at any time by texting Dinghy (for example &ldquo;disconnect my work gmail&rdquo;). Its tokens are deleted right away. You can also remove access at <a href="https://myaccount.google.com/permissions" style={{ color: 'var(--ink)', fontWeight: 600 }}>myaccount.google.com/permissions</a>.</li>
            <li>To delete your whole account and all associated data, email <a href="mailto:halsey@biscayneventures.xyz" style={{ color: 'var(--ink)', fontWeight: 600 }}>halsey@biscayneventures.xyz</a>. We delete it within 30 days.</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Children</h2>
          <p>Dinghy is not for anyone under 13, and we do not knowingly collect their information.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Changes</h2>
          <p>If we change this policy we will update this page and the date above. If a change affects how we use Google user data, we will tell you in Dinghy before it applies.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Contact</h2>
          <p>Questions or requests: <a href="mailto:halsey@biscayneventures.xyz" style={{ color: 'var(--ink)', fontWeight: 600 }}>halsey@biscayneventures.xyz</a>. See also our <Link href="/terms" style={ color: 'var(--ink)', fontWeight: 600 }>terms of service</Link>.</p>
        </section>
      </div>
    </HarborShell>
  )
}
