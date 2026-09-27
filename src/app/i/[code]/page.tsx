import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { hashInviteCode } from '@/lib/spectrum/beta-gate'
import { PUBLIC_DINGHY_LINE } from '@/lib/spectrum/user-invites'
import { startSmsLink } from '@/lib/spectrum/start-link'
import StartButton from '@/app/start/[token]/start-button'
import styles from '@/app/start/[token]/start.module.css'

export const metadata: Metadata = { title: "You're invited to Dinghy", robots: { index: false, follow: false, noarchive: true } }
export const dynamic = 'force-dynamic'

const CODE_FORMAT = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params
    const normalized = decodeURIComponent(code).toUpperCase()
    if (!CODE_FORMAT.test(normalized)) notFound()

    const { data, error } = await createServerClient().from('beta_invites')
        .select('uses, max_uses, expires_at').eq('code_hash', hashInviteCode(normalized)).maybeSingle()
    const valid = !error && data && data.uses < data.max_uses && new Date(data.expires_at) > new Date()


    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <div className={styles.brand}><Image src="/icon-512.png" alt="" width="48" height="48" /> Dinghy</div>
                <p className={styles.eyebrow}>{valid ? 'Your seat is ready' : 'This invite has sailed'}</p>
                <h1>{valid ? 'A friend saved you a seat.' : 'This invite is no longer open.'}</h1>
                {valid ? <>
                    <p className={styles.intro}>First, claim your invite in Messages from the phone you want to use with Dinghy. Then text your first request in that same thread.</p>
                    <div className={styles.choices}><StartButton href={startSmsLink(PUBLIC_DINGHY_LINE, normalized)} label="Claim my spot" /></div>
                    <p className={styles.fallback}>If the button doesn't open Messages, text <strong>{normalized}</strong> to <a href={`tel:${PUBLIC_DINGHY_LINE}`}>{PUBLIC_DINGHY_LINE}</a>.</p>
                    <p className={styles.fine}>The first text claims your invite. Dinghy replies in that thread.</p>
                </> : <p className={styles.intro}>This invite was used up, expired, or wasn't real. Ask the friend who sent it for a new one, or <a href="https://www.getdinghy.sh">join the waitlist</a>.</p>}
            </div>
        </main>
    )
}
