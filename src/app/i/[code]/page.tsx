import Image from 'next/image'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import { hashInviteCode } from '@/lib/spectrum/beta-gate'
import { PUBLIC_DINGHY_LINE } from '@/lib/spectrum/user-invites'

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

    const sms = `sms:${PUBLIC_DINGHY_LINE}?&body=${encodeURIComponent(normalized)}`

    return (
        <main style={{
            minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1.5rem', background: 'var(--navy, #0b1220)',
        }}>
            <div style={{
                maxWidth: '26rem', width: '100%', display: 'grid', gap: '1rem',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '1.25rem',
                padding: '2rem 1.6rem', background: 'rgba(255,255,255,0.04)',
                color: 'var(--cream, #f4efe6)', textAlign: 'center',
            }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Image src="/icon-512.png" alt="" width="56" height="56" />
                </div>
                <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
                    {valid ? "You're in." : 'This invite has sailed.'}
                </h1>
                {valid ? (
                    <>
                        <p style={{ fontSize: '0.92rem', opacity: 0.8, lineHeight: 1.5 }}>
                            Someone brought you aboard Dinghy — your AI first mate over iMessage.
                            Tap below to claim your spot: it opens a text with your invite code already in it. Just hit send.
                        </p>
                        <a href={sms} style={{
                            display: 'block', padding: '0.85rem 1rem', borderRadius: '999px',
                            background: 'var(--accent, #f4a63c)', color: '#0b1220',
                            fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                        }}>
                            Claim my spot →
                        </a>
                        <p style={{ fontSize: '0.78rem', opacity: 0.6 }}>
                            Button doesn&apos;t open Messages? Text <strong>{normalized}</strong> to {PUBLIC_DINGHY_LINE} yourself.
                        </p>
                    </>
                ) : (
                    <p style={{ fontSize: '0.92rem', opacity: 0.8, lineHeight: 1.5 }}>
                        This invite code is used up, expired, or wasn&apos;t real. Ask the friend who sent it —
                        or join the waitlist at <a href="https://www.getdinghy.sh" style={{ color: 'inherit' }}>getdinghy.sh</a>.
                    </p>
                )}
            </div>
        </main>
    )
}
