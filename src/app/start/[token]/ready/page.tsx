import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { prettyPhone } from '@/lib/spectrum/photon-users'
import { firstLookCopy, startGooglePath, startSmsLink, START_FIRST_TEXT, type FirstLookStatus } from '@/lib/spectrum/start-link'
import StartButton from '../start-button'
import FirstLookCard from './first-look-card'
import styles from '../start.module.css'

export const metadata: Metadata = { title: 'Your Dinghy is ready', robots: { index: false, follow: false, noarchive: true } }
export const dynamic = 'force-dynamic'

export default async function ReadyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const { data, error } = await createServerClient().from('waitlist')
    .select('name, dinghy_line, status, first_look_status').eq('start_token', token).maybeSingle()
  if (error || !data || !['joined', 'invited', 'active'].includes(data.status) || !/^\+[1-9]\d{7,14}$/.test(data.dinghy_line ?? '')) notFound()
  // Not connected from this page yet: back to the connect screen.
  if (!data.first_look_status) redirect(`/start/${encodeURIComponent(token)}`)
  const line = data.dinghy_line as string
  const firstName = (data.name ?? '').trim().split(/\s+/)[0] ?? ''
  const displayName = /^[\p{L}][\p{L}'-]{0,39}$/u.test(firstName) ? firstName : null
  const initial = { status: data.first_look_status as FirstLookStatus, ...firstLookCopy(data.first_look_status as FirstLookStatus) }
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><Image src="/icon-512.png" alt="" width="48" height="48" /> Dinghy</div>
        <p className={styles.eyebrow}>Google connected</p>
        <h1>{displayName ? `${displayName}, text me to start.` : 'Text me to start.'}</h1>
        <p className={styles.intro}>This is your personal Dinghy number. Send the first text and I answer right away. Save it as a contact when I send the card.</p>
        <p className={styles.number}>{prettyPhone(line)}</p>
        <div className={styles.choices}>
          <StartButton href={startSmsLink(line, START_FIRST_TEXT)} label="Text Dinghy" />
        </div>
        <FirstLookCard token={token} initial={initial} />
        <p className={styles.fallback}>If the button doesn’t open Messages, copy the number above and text it from the phone you signed up with.</p>
        <p className={styles.fine}>Wrong Google account? <a href={startGooglePath(token)}>Connect again</a>. There’s no invite code.</p>
      </div>
    </main>
  )
}
