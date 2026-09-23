import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { redeemKeyLink } from '@/lib/integrations/paybox-key-link'
import { hitRateLimit } from '@/lib/spectrum/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.object({ t: z.string().min(16).max(128), signingKey: z.string().max(4096) })

/** Save a pasted pbxk1. signing key via a one-use link from the chat. */
export async function POST(request: NextRequest): Promise<NextResponse> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rate = await hitRateLimit(`paybox-key-link:${ip}`).catch(() => 'ok' as const)
    if (rate !== 'ok') return NextResponse.json({ error: 'Too many tries. Wait a minute.' }, { status: 429 })

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const parsed = Body.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const res = await redeemKeyLink(parsed.data.t, parsed.data.signingKey)
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
    return NextResponse.json({ ok: true })
}
