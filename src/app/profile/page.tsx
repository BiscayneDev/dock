import DataErasurePanel from '@/components/profile/DataErasurePanel'
import { erasureEnabled } from '@/lib/data-portability/erasure-state'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { createServerClient } from '@/lib/supabase/server'
import { CoastShell, shellStyles } from '@/components/brand/CoastShell'
import styles from './profile.module.css'
import ProfilePanels from '@/components/profile/ProfilePanels'
import ConnectionsPanel from '@/components/profile/ConnectionsPanel'
import { listConnections } from '@/lib/profile/connections'

export const metadata: Metadata = {
  title: 'Your profile · Dinghy',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

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
  searchParams: Promise<{ connected?: string; disconnected?: string; revoked?: string; disconnect?: string; revoked_login?: string; revoke?: string }>
}): Promise<React.JSX.Element> {
  const session = await getSession()
  if (!session) redirect('/login')
  const { connected, disconnected, revoked, disconnect, revoked_login, revoke } = await searchParams

  const supabase = createServerClient()
  const [{ data: user }, { data: identity }, { data: tokens }] = await Promise.all([
    supabase.from('users').select('name, timezone, created_at').eq('id', session.userId).maybeSingle(),
    supabase.from('spectrum_identities').select('chat_guid, handle').eq('user_id', session.userId).order('bound_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('oauth_tokens').select('provider').eq('user_id', session.userId),
  ])
  const have = new Set(((tokens ?? []) as Array<{ provider: string }>).map((t) => (t.provider.startsWith('google:') ? 'google' : t.provider)))
  const connections = await listConnections(session.userId).catch(() => ({ accounts: [], capabilities: [], runs: [] }))
  const tz = user?.timezone && user.timezone !== 'UTC' ? (user.timezone as string) : 'America/New_York'
  const chatGuid = (identity?.chat_guid as string | undefined) ?? null
  const phone = formatPhone((identity?.handle as string | undefined) ?? null)

  const { data: assigned } = phone ? await supabase.from('waitlist')
    .select('dinghy_line').eq('phone', identity?.handle as string).in('status', ['invited', 'active']).not('dinghy_line', 'is', null).limit(1).maybeSingle() : { data: null }
  const assignedLine = (assigned?.dinghy_line as string | undefined) ?? null

  let reminders: Array<{ id: string; message: string; fire_at: string }> = []
  if (chatGuid) {
    const { data } = await supabase.rpc('dinghy_reminder_list', { p_chat_guid: chatGuid })
    reminders = Array.isArray(data) ? (data as typeof reminders).slice(0, 5) : []
  }

  const rawName = (user?.name as string | undefined) ?? ''
  const firstName = rawName && rawName !== 'iMessage user' ? rawName.split(' ')[0] : null
  const connectedName = connected ? ACCOUNTS.find((a) => a.provider === connected)?.name : null

  return (
    <CoastShell
      home
      right={
        <form action="/api/auth/dinghy/logout" method="post">
          <button type="submit" className={shellStyles.navlink}>Sign out</button>
        </form>
      }
    >
      <div className={styles.label}>Your Dinghy</div>
      <h1 className={styles.title}>{firstName ? <>Hello, <em>{firstName}</em></> : <>Welcome <em>aboard</em></>}</h1>
      <p className={styles.meta}>{phone ? `Signed in as ${phone}` : 'Signed in'}</p>
      {connectedName && <p className={styles.flash}>{connectedName} is connected.</p>}
      {disconnected && <p className={styles.flash}>{disconnected} disconnected.{revoked === '1' ? ' Access was also ended at the provider.' : ' Remove Dinghy in that app too to end the grant fully.'}</p>}
      {revoked_login && <p className={styles.flash}>Browser login revoked.</p>}
      {(disconnect || revoke) && <p className={styles.flash}>Could not do that. Nothing was changed.</p>}

      <ProfilePanels />
      {erasureEnabled() && <DataErasurePanel />}

      <ConnectionsPanel data={connections} tz={tz} connectLinks={ACCOUNTS.filter((a) => !have.has(a.provider)).map((a) => ({ name: a.name, auth: a.auth }))} />

      <section className={styles.section}>
        <h2 className={styles.h2}>Upcoming reminders</h2>
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

      {assignedLine ? <a className={styles.cta} href={`sms:${assignedLine}`}>Text Dinghy <span aria-hidden="true">{'\u2192'}</span></a> : <p className={styles.meta}>Use the number in your Dinghy invitation to text. If you need it again, check your invite email.</p>}
    </CoastShell>
  )
}
