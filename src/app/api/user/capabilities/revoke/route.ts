import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { revokeCapabilityById } from '@/lib/capabilities/store'
import { sameOrigin } from '@/lib/auth/same-origin'

export const dynamic = 'force-dynamic'
const base = () => process.env.NEXT_PUBLIC_APP_URL || 'https://www.getdinghy.sh'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest): Promise<NextResponse> {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } })
    if (!sameOrigin(request)) return NextResponse.json({ error: 'Bad origin' }, { status: 403 })
    const form = await request.formData().catch(() => null)
    const id = String(form?.get('id') ?? '')
    if (!UUID.test(id)) return NextResponse.redirect(new URL('/profile?revoke=invalid', base()), 303)
    try {
        const n = await revokeCapabilityById(session.userId, id)
        return NextResponse.redirect(new URL(`/profile?${n ? 'revoked_login=1' : 'revoke=notfound'}`, base()), 303)
    } catch {
        return NextResponse.redirect(new URL('/profile?revoke=error', base()), 303)
    }
}
