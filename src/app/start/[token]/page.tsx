import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { prettyPhone } from '@/lib/spectrum/photon-users'
import { START_TASKS, startGooglePath, startReadyPath, startSmsLink } from '@/lib/spectrum/start-link'
import StartButton from './start-button'
import styles from './start.module.css'

export const metadata: Metadata = { title: 'Start with Dinghy', robots: { index: false, follow: false, noarchive: true } }
export const dynamic = 'force-dynamic'

export default async function StartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) notFound()
  const { data, error } = await createServerClient().from('waitlist')
    .select('name, dinghy_line, status, phone').eq('start_token', token).maybeSingle()
  if (error || !data || !['joined', 'invited', 'active'].includes(data.status) || !/^\+[1-9]\d{7,14}$/.test(data.dinghy_line ?? '')) notFound()
  // Already connected from this page: send them to their number. A missing column (migration 066
  // not applied yet) just means they see the connect screen.
  const { data: look } = await createServerClient().from('waitlist').select('first_look_status').eq('start_token', token).maybeSingle()
  if (look?.first_look_status) redirect(startReadyPath(token))
  const line = data.dinghy_line as string
  const firstName = (data.name ?? '').trim().split(/\s+/)[0] ?? ''
  const displayName = /^[\p{L}][\p{L}'-]{0,39}$/u.test(firstName) ? firstName : null
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.brand}><Image src="/icon-512.png" alt="" width="48" height="48" /> Dinghy</div>
        <p className={styles.eyebrow}>Your seat is ready</p>
        <h1>{displayName ? `${displayName}, your Dinghy line is ready.` : 'Your Dinghy line is ready.'}</h1>
        <p className={styles.eyebrow}>Step one</p>
        <p className={styles.intro}>Connect Google and I take one first look at your calendar and inbox. I read headers only, never message bodies: who writes to you and what is on your calendar. No model reads that first look, and your Google data is never used to train AI models. You can disconnect any time and I stop reading. <a href="/privacy">How I use Google data</a></p>
        <div className={styles.choices}>
          <StartButton href={startGooglePath(token)} label="Connect Google" />
        </div>
        <p className={styles.eyebrow}>Or skip Google</p>
        <p className={styles.intro}>Choose a first request, or write your own. It opens in Messages to your personal Dinghy number. Edit before sending from the phone you signed up with. You can connect Google any time in the chat.</p>
        <div className={styles.choices}>
          {START_TASKS.map((task) => <StartButton key={task.label} href={startSmsLink(line, task.text)} label={task.label} />)}
        </div>
        <p className={styles.fallback}>If the button doesn’t open Messages, copy this number and text it yourself:<br /><a href={`tel:${line}`}>{prettyPhone(line)}</a></p>
        <p className={styles.fine}>Your first text starts the conversation. There’s no invite code.</p>
      </div>
    </main>
  )
}
