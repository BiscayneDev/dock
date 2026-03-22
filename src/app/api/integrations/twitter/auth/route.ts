import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/session'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getTwitterAuthUrl,
} from '@/lib/integrations/twitter'

export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  // Generate PKCE code verifier and challenge
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)

  // Store code verifier in a short-lived cookie (needed for token exchange)
  const cookieStore = await cookies()
  cookieStore.set('twitter_cv', codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  return NextResponse.redirect(getTwitterAuthUrl(codeChallenge))
}
