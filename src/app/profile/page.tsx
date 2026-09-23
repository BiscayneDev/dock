import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { CoastShell, shellStyles } from '@/components/brand/CoastShell'
import styles from './profile.module.css'

export const metadata: Metadata = {
  title: 'Your profile · Dinghy',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const DINGHY_SMS = 'sms:+16282647754'

/** What Dinghy can reach. Read-only everywhere from iMessage today. */
const ACCOUNTS: Array<{ provider: string; name: string; desc: string; auth: string }> = [
  { provider: 'google', name: 'Google', desc: 'Gmail and Calendar', auth: '/api/integrations/google/auth' },
  { provider: 'paybox', name: 'PayBox', desc: 'Wallet balances (read-only)', auth: '/api/integrations/paybox/auth' },
  { provider: 'github', name: 'GitHub', desc: 'Repos, issues and pull requests', auth: '/api/integrations/github/auth' },
  { provider: 'oura', name: 'Oura', desc: 'Sleep, readiness and activity', auth: '/api/integrations/oura/auth' },
  { provider: 'whoop', name: 'WHOOP', desc: 'Recovery, sleep and strain', auth: '/api/integrations/whoop/auth' },
]

function formatPhone(p: string | null): string | null {
  if (!p) return null
  const m = p.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p
}

function formatWhen(iso: string, tz: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string }>
}): Promise<React.JSX.Element> {
  const session = await getSession()
  if (!session) redirect('/login')
  const { connected } = await searchParams

  const supabase = createServerClient()
  const [{ data: user }, { data: identity }, { data: tokens }] = await Promise.all([
    supabase.from('users').select('name, timezone, created_at').eq('id', session.userId).maybeSingle(),
    supabase.from('spectrum_identities').select('chat_guid, handle').eq('user_id', session.userId).order('bound_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('oauth_tokens').select('provider').eq('user_id', session.userId),
  ])
  const have = new Set(((tokens ?? []) as Array<{ provider: string }>).map((t) => t.provider))
  const tz = user?.timezone && user.timezone !== 'UTC' ? (user.timezone as string) : 'America/New_York'
  const chatGuid = (identity?.chat_guid as string | undefined) ?? null
  const phone = formatPhone((identity?.handle as string | undefined) ?? null)

  let reminders: Array<{ id: string; message: string; fire_at: string }> = []
  if (chatGuid) {
    const { data } = await supabase.rpc('dinghy_reminder_list', { p_chat_guid: chatGuid })
    reminders = Array.isArray(data) ? (data as typeof reminders).slice(0, 5) : []
  }

  const rawName = (user?.name as string | undefined) ?? ''
  const firstName = rawName && rawName !== 'iMessage user' ? rawName.split(' ')[0].toLowerCase() : null
  const connectedName = connected ? ACCOUNTS.find((a) => a.provider === connected)?.name : null

  return (
    <CoastShell
      wide
      right={
        <form action="/api/auth/dinghy/logout" method="post">
          <button type="submit" className={shellStyles.navlink}>sign out</button>
        </form>
      }
    >
      <div className={styles.label}>your dinghy</div>
      <h1 className={styles.title}>{firstName ? <>ahoy, <em>{firstName}</em></> : <>welcome <em>aboard</em></>}</h1>
      <p className={styles.meta}>{phone ? `Signed in as ${phone}` : 'Signed in'}</p>
      {connectedName && <p className={styles.flash}>{connectedName} is connected.</p>}

      <section className={styles.section}>
        <h2 className={styles.h2}>connected accounts</h2>
        <ul className={styles.list}>
          {ACCOUNTS.map((a) => (
            <li key={a.provider} className={styles.item}>
              <div className={styles.grow}>
                <div className={styles.name}>{a.name}</div>
                <div className={styles.desc}>{a.desc}</div>
              </div>
              {have.has(a.provider) ? <span className={styles.on}>connected</span> : <a className={styles.connect} href={a.auth}>connect</a>}
            </li>
          ))}
          <li className={styles.item}>
            <div className={styles.grow}>
              <div className={styles.name}>X</div>
              <div className={styles.desc}>Read posts and accounts. No account needed.</div>
            </div>
            <span className={styles.on}>on</span>
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2 className={styles.h2}>upcoming reminders</h2>
        <ul className={styles.list}>
          {reminders.length === 0 ? (
            <li><p className={styles.empty}>Nothing scheduled. Text Dinghy &ldquo;remind me&hellip;&rdquo; to set one.</p></li>
          ) : (
            reminders.map((r) => (
              <li key={r.id} className={styles.item}>
                <div className={`${styles.grow} ${styles.name}`}>{r.message}</div>
                <span className={styles.when}>{formatWhen(r.fire_at, tz)}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <a className={styles.cta} href={DINGHY_SMS}>text dinghy <span aria-hidden="true">{'\u2192'}</span></a>
    </CoastShell>
  )
}
