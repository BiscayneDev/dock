import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import { beginConnectByToken } from '@/lib/connect-token'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getOrRegisterClientId,
  getPayboxAuthUrl,
} from '@/lib/integrations/paybox'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const connectToken = request.nextUrl.searchParams.get('connect')
  if (connectToken) return startInThreadConnect(connectToken)

  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  let clientId: string
  try {
    // Reuse PAYBOX_CLIENT_ID if set, otherwise dynamically register a public client.
    clientId = await getOrRegisterClientId()
  } catch {
    return NextResponse.redirect(`${appUrl}/onboarding?error=paybox_register_failed`)
  }

  // PKCE (S256 required by Paybox).
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  // Stash the verifier + client_id for the callback (token exchange needs both).
  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: 600, // 10 minutes
    path: '/',
  }
  cookieStore.set('paybox_cv', codeVerifier, cookieOpts)
  cookieStore.set('paybox_client_id', clientId, cookieOpts)

  return NextResponse.redirect(getPayboxAuthUrl(clientId, codeChallenge))
}

/**
 * In-thread (iMessage) connect: no web session, so the PKCE verifier and
 * client id ride on the consumed connect-token row (encrypted) instead of
 * cookies, and the OAuth state binds the callback to that row. The token is
 * provider-bound — a Google connect link cannot start this flow.
 */
async function startInThreadConnect(connectToken: string): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // Register a public client bound to exactly this deployment's redirect URI
  // (PayBox matches redirect_uri exactly), unless one is pinned for iMessage.
  // The client id is stored with the tokens so refresh uses the same client.
  let clientId: string
  try {
    clientId = process.env.PAYBOX_IMESSAGE_CLIENT_ID ?? (await getOrRegisterClientId({ forceRegister: true }))
  } catch {
    return NextResponse.redirect(`${appUrl}/onboarding?error=paybox_register_failed`)
  }

  const codeVerifier = generateCodeVerifier()
  const started = await beginConnectByToken(connectToken, 'paybox', { verifier: codeVerifier, clientId })
  if (!started) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=connect_link_invalid`)
  }

  return NextResponse.redirect(
    getPayboxAuthUrl(clientId, generateCodeChallenge(codeVerifier), started.oauthState)
  )
}
