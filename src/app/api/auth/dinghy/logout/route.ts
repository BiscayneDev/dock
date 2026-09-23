import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/auth/session'

export async function POST(): Promise<NextResponse> {
    await clearSession()
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL || 'https://www.getdinghy.sh'), 303)
}
