import { NextRequest, NextResponse } from 'next/server'
import { normalizePhone, startLogin } from '@/lib/auth/dinghy-login'
import { enqueueOutbox, markOutboxSent } from '@/lib/spectrum/outbox'

/**
 * POST { phone } -> texts a sign-in code into the number's Dinghy thread.
 * Same answer whether or not the number is a member (no enumeration).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
    let phoneInput = ''
    try {
        phoneInput = String(((await request.json()) as { phone?: unknown }).phone ?? '')
    } catch {
        return NextResponse.json({ error: 'Enter your phone number.' }, { status: 400 })
    }
    const phone = normalizePhone(phoneInput)
    if (!phone) return NextResponse.json({ error: 'That doesn\u2019t look like a phone number.' }, { status: 400 })

    try {
        const result = await startLogin(phone, async (chatGuid, text) => {
            // Outbox first so the sweep retries if the direct send fails.
            const id = await enqueueOutbox(chatGuid, 'reply', text)
            try {
                const { getSpectrumApp, getImessage } = await import('@/lib/spectrum/app')
                const im = await getImessage(await getSpectrumApp())
                const space = await im.space.get(chatGuid)
                await space.send(text)
                if (id) await markOutboxSent(id)
            } catch (err) {
                console.error('login code direct send failed; left for sweep:', err instanceof Error ? err.message : String(err))
            }
        })
        if (result.limited) {
            return NextResponse.json({ error: 'Too many codes. Try again in an hour.' }, { status: 429 })
        }
    } catch (err) {
        console.error('login start failed:', err instanceof Error ? err.message : String(err))
        return NextResponse.json({ error: 'Something went wrong. Try again in a moment.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, phone })
}
