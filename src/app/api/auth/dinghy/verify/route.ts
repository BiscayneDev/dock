import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone, verifyLogin } from '@/lib/auth/dinghy-login'
import { bindSpectrumIdentity } from '@/lib/connect-token'
import { setSession } from '@/lib/auth/session'

/** POST { phone, code } -> signed session for the Dinghy account behind that thread. */
export async function POST(request: NextRequest): Promise<NextResponse> {
    let body: { phone?: unknown; code?: unknown } = {}
    try {
        body = (await request.json()) as typeof body
    } catch {
        return NextResponse.json({ error: 'Enter the code.' }, { status: 400 })
    }
    const phone = normalizePhone(String(body.phone ?? ''))
    const code = String(body.code ?? '').replace(/\D/g, '')
    if (!phone || code.length !== 6) return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 })

    try {
        const chatGuid = await verifyLogin(phone, code)
        if (!chatGuid) return NextResponse.json({ error: 'That code didn\u2019t work. Check it, or send a new one.' }, { status: 401 })
        const userId = await bindSpectrumIdentity(chatGuid, phone)
        if (!userId) return NextResponse.json({ error: 'This number isn\u2019t in the beta yet.' }, { status: 403 })
        await setSession(userId, 0)
    } catch (err) {
        console.error('login verify failed:', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ error: 'Something went wrong. Try again in a moment.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, redirect: '/profile' })
}
