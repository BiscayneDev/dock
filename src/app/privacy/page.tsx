import { HarborShell } from '@/components/HarborShell'

export default function PrivacyPolicy() {
  return (
    <HarborShell title="Privacy Policy" showBack backHref="/">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', fontSize: '0.9rem', lineHeight: 1.7, opacity: 0.8 }}>
        <p style={{ fontFamily: "'Outfit', sans-serif", fontSize: '0.75rem', opacity: 0.5 }}>
          Last updated: March 22, 2026
        </p>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>What Dock Is</h2>
          <p>
            Dock is an AI assistant that lives in Telegram and helps you manage email, calendar, GitHub, Notion, crypto wallets, and health data. It also provides a companion web app (&ldquo;The Harbor&rdquo;) for account management, integrations, and recipe automation.
          </p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Information We Collect</h2>
          <p><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Account information:</strong> When you connect via Telegram, we store your Telegram user ID, first name, and username. No phone number or password is collected.</p>
          <p style={{ marginTop: '0.5rem' }}><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Integration tokens:</strong> When you connect services (Google, GitHub, Notion, Oura, WHOOP, MoonPay), we store encrypted OAuth access tokens and refresh tokens. These are used solely to make API calls on your behalf. All tokens are encrypted at rest using AES-256-GCM.</p>
          <p style={{ marginTop: '0.5rem' }}><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Messages:</strong> Your conversation history with the Dock bot is stored to maintain context across sessions. Messages are associated with your user ID and are not shared with other users.</p>
          <p style={{ marginTop: '0.5rem' }}><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Health data:</strong> If you connect Oura Ring or WHOOP, we access sleep, readiness/recovery, activity, and heart rate data through their APIs. This data is fetched on demand and not stored persistently — it is retrieved each time the agent needs it.</p>
          <p style={{ marginTop: '0.5rem' }}><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Recipes and automation:</strong> Recipes you create (including instructions, trigger configurations, and run history) are stored in our database.</p>
          <p style={{ marginTop: '0.5rem' }}><strong style={{ fontFamily: "'Outfit', sans-serif" }}>Wallet information:</strong> If you connect a MoonPay wallet, your wallet address and chain preference are stored. Private keys are never stored by Dock — signing happens through the OpenWallet Standard (OWS) client you control.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li>Execute the actions you request (send emails, create events, check balances, etc.)</li>
            <li>Run automated recipes on the schedules and triggers you configure</li>
            <li>Maintain conversation context so the assistant remembers previous interactions</li>
            <li>Learn your communication preferences to personalize responses</li>
            <li>Process payments for paid recipes via the x402 protocol</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Third-Party Services</h2>
          <p>Dock integrates with the following third-party services. Each has its own privacy policy:</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li>Google (Gmail, Calendar) — for email and calendar management</li>
            <li>GitHub — for repository, issue, and PR management</li>
            <li>Notion — for page and database management</li>
            <li>Oura — for sleep, readiness, and activity data</li>
            <li>WHOOP — for recovery, strain, and heart rate data</li>
            <li>MoonPay / OpenWallet — for crypto wallet operations</li>
            <li>OpenAI — for AI language model processing</li>
            <li>Telegram — for bot messaging</li>
            <li>Supabase — for data storage</li>
            <li>Vercel — for hosting</li>
          </ul>
          <p style={{ marginTop: '0.5rem' }}>Your messages are sent to OpenAI for processing. We do not use your data to train AI models.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Data Security</h2>
          <p>All OAuth tokens are encrypted using AES-256-GCM before storage. Sessions use httpOnly cookies with 7-day expiration. Magic sign-in links use HMAC-SHA256 signatures with 15-minute TTL. We do not store passwords — authentication is handled through Telegram.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Data Retention</h2>
          <p>Your data is retained for as long as your account is active. Conversation history is automatically summarized after 50 messages to manage storage. You can delete your entire account and all associated data at any time from Settings {">"} Danger Zone.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Your Rights</h2>
          <p>You can:</p>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            <li>Disconnect any integration at any time (removes stored tokens)</li>
            <li>Delete your entire account and all data from Settings</li>
            <li>Request a copy of your data by contacting us</li>
          </ul>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>x402 Payments</h2>
          <p>When using paid recipes or x402 services, payments are processed on-chain (USDC on Base, Ethereum, or Solana). Transaction hashes are stored for record-keeping. Dock does not hold or custody any funds — all transactions are initiated through your connected wallet.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Children</h2>
          <p>Dock is not intended for use by anyone under the age of 13. We do not knowingly collect personal information from children.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Changes</h2>
          <p>We may update this policy from time to time. Changes will be posted on this page with an updated date.</p>
        </section>

        <section>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Contact</h2>
          <p>Questions about this policy? Reach out via Telegram at <a href="https://t.me/heydeckhandbot" style={{ color: 'var(--ink)', fontWeight: 600 }}>@heydeckhandbot</a>.</p>
        </section>
      </div>
    </HarborShell>
  )
}
