import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { sameOrigin } from '@/lib/auth/same-origin'
import { disconnectConnection } from '@/lib/profile/disconnect'

export const dynamic = 'force-dynamic'

const base = () => process.env.NEXT_PUBLIC_APP_URL || 'https://www.getdinghy.sh'

export async function POST(request: NextRequest): Promise<NextResponse> {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
    if (!sameOrigin(request)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
    const form = await request.formData().catch(() => null)
    const provider = String(form?.get('provider') ?? '')
    if (!provider || provider.length > 120) return NextResponse.redirect(new URL('/profile?disconnect=invalid', base()), 303)
    try {
        const out = await disconnectConnection(session.userId, provider)
        const q = out ? `disconnected=${encodeURIComponent(out.name)}&revoked=${out.revokedAtProvider ? '1' : '0'}` : 'disconnect=notfound'
        return NextResponse.redirect(new URL(`/profile?${q}`, base()), 303)
    } catch {
        return NextResponse.redirect(new URL('/profile?disconnect=error', base()), 303)
    }
}
