import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { hashInviteCode } from '@/lib/spectrum/beta-gate'
import { CLAIM_ERRORS } from '@/lib/spectrum/invite-claim'
import { claimSeat } from './actions'
import styles from '@/app/start/[token]/start.module.css'

export const metadata: Metadata = { title: "You're invited to Dinghy", robots: { index: false, follow: false, noarchive: true } }
export const dynamic = 'force-dynamic'

const CODE_FORMAT = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/

export default async function InvitePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ e?: string }> }) {
    const { code } = await params
    const { e } = await searchParams
    const claimError = e ? CLAIM_ERRORS[e] : undefined
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
                    <p className={styles.eyebrow}>Step one</p>
                    <p className={styles.intro}>Tell me which iPhone you will text from. I set up your own Dinghy number, then you connect Google and I take a first look at your day. I read headers only, never message bodies, and no model reads that first look.</p>
                    {claimError ? <p className={styles.fallback} role="alert">{claimError}</p> : null}
                    <form action={claimSeat} className={styles.choices}>
                        <input type="hidden" name="code" value={normalized} />
                        <input className={styles.field} name="name" type="text" autoComplete="given-name" placeholder="First name (optional)" maxLength={80} />
                        <input className={styles.field} name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="Your iPhone number" required />
                        <button className={styles.button} type="submit">Get my seat <span aria-hidden="true">→</span></button>
                    </form>
                    <p className={styles.fine}>Next you connect Google, then I show you the exact number to text. No code to type.</p>
                </> : <p className={styles.intro}>This invite was used up, expired, or wasn&apos;t real. Ask the friend who sent it for a new one, or <a href="https://www.getdinghy.sh">join the waitlist</a>.</p>}
            </div>
        </main>
    )
}
