import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import {
  exchangeCode as exchangeGoogleCode,
  storeGoogleTokens,
} from '@/lib/integrations/google'
import {
  exchangeCode as exchangeNotionCode,
  storeNotionTokens,
} from '@/lib/integrations/notion'
import {
  exchangeCode as exchangeGithubCode,
  storeGithubTokens,
} from '@/lib/integrations/github'
import {
  exchangeOuraCode,
  storeOuraTokens,
} from '@/lib/integrations/oura'
import {
  exchangeWhoopCode,
  storeWhoopTokens,
} from '@/lib/integrations/whoop'
import {
  exchangeTwitterCode,
  storeTwitterTokens,
} from '@/lib/integrations/twitter'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  const { provider } = await params
  const code = request.nextUrl.searchParams.get('code')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (!code) {
    return NextResponse.redirect(`${appUrl}/dashboard?error=no_code`)
  }

  try {
    switch (provider) {
      case 'google': {
        const result = await exchangeGoogleCode(code)
        await storeGoogleTokens(
          session.userId,
          result.accessToken,
          result.refreshToken,
          result.expiresAt,
          ['gmail.readonly', 'gmail.send', 'gmail.modify', 'calendar.readonly', 'calendar.events'],
          result.email
        )
        break
      }

      case 'notion': {
        const result = await exchangeNotionCode(code)
        await storeNotionTokens(
          session.userId,
          result.accessToken,
          result.workspaceName
        )
        break
      }

      case 'github': {
        const result = await exchangeGithubCode(code)
        await storeGithubTokens(
          session.userId,
          result.accessToken,
          result.username
        )
        break
      }

      case 'oura': {
        const result = await exchangeOuraCode(code)
        await storeOuraTokens(
          session.userId,
          result.accessToken,
          result.refreshToken,
          result.expiresAt
        )
        break
      }

      case 'whoop': {
        const result = await exchangeWhoopCode(code)
        await storeWhoopTokens(
          session.userId,
          result.accessToken,
          result.refreshToken,
          result.expiresAt
        )
        break
      }

      case 'twitter': {
        // Retrieve PKCE code verifier from cookie
        const { cookies } = await import('next/headers')
        const cookieStore = await cookies()
        const codeVerifier = cookieStore.get('twitter_cv')?.value
        if (!codeVerifier) {
          return NextResponse.redirect(`${appUrl}/onboarding?error=twitter_pkce_expired`)
        }

        const result = await exchangeTwitterCode(code, codeVerifier)
        await storeTwitterTokens(
          session.userId,
          result.accessToken,
          result.refreshToken,
          result.expiresAt,
          result.userId,
          result.username
        )

        // Clear the code verifier cookie
        cookieStore.delete('twitter_cv')
        break
      }

      default:
        return NextResponse.redirect(`${appUrl}/dashboard?error=unknown_provider`)
    }

    return NextResponse.redirect(`${appUrl}/onboarding?connected=${provider}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const { logger } = await import('@/lib/logger')
    logger.error(`OAuth callback error for ${provider}`, { error: message })
    return NextResponse.redirect(`${appUrl}/onboarding?error=oauth_failed`)
  }
}
