import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAuthUrl, GOOGLE_OAUTH_SCOPES, hasStoredGoogleConnection } from '@/lib/integrations/google'
import { beginConnectByToken } from '@/lib/connect-token'
import { randomBytes } from 'crypto'

const STATE_COOKIE = 'g_oauth_state'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? ''
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const connectToken = request.nextUrl.searchParams.get('connect')

  // --- In-thread connect flow (Telegram / iMessage, no web session) ---
  if (connectToken) {
    const started = await beginConnectByToken(connectToken)
    if (!started) {
      // Invalid, expired, or already used — send the user back to their chat
      // to request a fresh link rather than starting an unbound OAuth flow.
      return NextResponse.redirect(`${appUrl()}/onboarding?error=connect_link_invalid`)
    }
    // Connect flow only fires when unconnected → first connect → consent.
    const url = getAuthUrl(GOOGLE_OAUTH_SCOPES, started.oauthState, { forceConsent: true })
    return NextResponse.redirect(url)
  }

  // --- Session flow (The Harbor / onboarding web UI) ---
  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(`${appUrl()}/login`)
  }

  // CSRF protection: bind this browser session to the OAuth round trip.
  const state = randomBytes(24).toString('hex')
  // Consent only when this account has no Google refresh token yet; a
  // reconnect skips the re-consent screen.
  const forceConsent = !(await hasStoredGoogleConnection(session.userId))
  const url = getAuthUrl(GOOGLE_OAUTH_SCOPES, state, { forceConsent })
  const response = NextResponse.redirect(url)
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })
  return response
}
