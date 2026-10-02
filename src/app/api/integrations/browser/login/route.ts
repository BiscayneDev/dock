import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cancelLogin, finishLogin, startLogin } from '@/lib/browser-sessions/login'
import { hitRateLimit } from '@/lib/spectrum/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const Body = z.object({ t: z.string().min(16).max(128), action: z.enum(['start', 'finish', 'cancel']) })

/**
 * Drive a remote-browser login from the one-use page. POST only, never GET:
 * iMessage unfurls links, and a crawler must not be able to boot a sandbox.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const rate = await hitRateLimit(`browser-login:${ip}`).catch(() => 'ok' as const)
    if (rate !== 'ok') return NextResponse.json({ error: 'Too many tries. Wait a minute.' }, { status: 429 })

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const parsed = Body.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { t, action } = parsed.data

    if (action === 'start') {
        const r = await startLogin(t)
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
        return NextResponse.json({ ok: true, viewUrl: r.viewUrl, site: r.site, resumed: r.resumed })
    }
    if (action === 'finish') {
        const r = await finishLogin(t)
        if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
        return NextResponse.json({ ok: true, site: r.site })
    }
    await cancelLogin(t)
    return NextResponse.json({ ok: true })
}
