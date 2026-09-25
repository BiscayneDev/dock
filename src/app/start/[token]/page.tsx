import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { prettyPhone } from '@/lib/spectrum/photon-users'
import { FIRST_TASK, startSmsLink } from '@/lib/spectrum/start-link'
import StartButton from './start-button'
import styles from './start.module.css'

export const metadata: Metadata = { title: 'Start with Dinghy', robots: { index: false, follow: false, noarchive: true } }
export const dynamic = 'force-dynamic'

export default async function StartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const { data, error } = await createServerClient().from('waitlist')
    .select('dinghy_line, status').eq('start_token', token).maybeSingle()
  if (error || !data || !['joined', 'invited', 'active'].includes(data.status) || !/^\+[1-9]\d{7,14}$/.test(data.dinghy_line ?? '')) notFound()
  const line = data.dinghy_line as string
  const sms = startSmsLink(line)
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><Image src="/icon-512.png" alt="" width="48" height="48" /> Dinghy</div>
        <p className={styles.eyebrow}>Your seat is ready</p>
        <h1>Put Dinghy to work.</h1>
        <p className={styles.intro}>Tap below to open a text to your personal Dinghy number. We have a first request ready. Edit it or ask anything else, then send it from the phone you signed up with.</p>
        <div className={styles.sample}>“{FIRST_TASK}”</div>
        <StartButton href={sms} />
        <p className={styles.fallback}>If the button doesn’t open Messages, copy this number and text it yourself:<br /><a href={`tel:${line}`}>{prettyPhone(line)}</a></p>
        <p className={styles.fine}>Your first text starts the conversation. There’s no invite code.</p>
      </div>
    </main>
  )
}
