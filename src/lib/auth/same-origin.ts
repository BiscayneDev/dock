import type { NextRequest } from 'next/server'

const appBase = () => process.env.NEXT_PUBLIC_APP_URL || 'https://www.getdinghy.sh'

/** Same-origin form posts only. Browsers always send Origin on a cross-site POST, so a missing one is refused. */
export function sameOrigin(request: NextRequest): boolean {
    const origin = request.headers.get('origin')
    if (!origin) return false
    try { return new URL(origin).origin === new URL(appBase()).origin || origin === request.nextUrl.origin } catch { return false }
}
