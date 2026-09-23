import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { getAuthUrl } from '@/lib/integrations/github'
import { beginConnectByToken } from '@/lib/connect-token'

export async function GET(request?: NextRequest): Promise<NextResponse> {
  // In-thread connect flow (iMessage, no web session): one-use token -> state.
  const connectToken = request?.nextUrl?.searchParams.get('connect')
  if (connectToken) {
    const started = await beginConnectByToken(connectToken, 'github')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (!started) return NextResponse.redirect(`${appUrl}/onboarding?error=connect_link_invalid`)
    return NextResponse.redirect(getAuthUrl(['repo', 'notifications'], started.oauthState))
  }

  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  return NextResponse.redirect(getAuthUrl())
}
