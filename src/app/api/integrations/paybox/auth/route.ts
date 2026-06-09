import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getOrRegisterClientId,
  getPayboxAuthUrl,
} from '@/lib/integrations/paybox'

export async function GET(): Promise<NextResponse> {
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
