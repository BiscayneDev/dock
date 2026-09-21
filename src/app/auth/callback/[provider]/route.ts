import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import {
  exchangeCode as exchangeGoogleCode,
  storeGoogleTokens,
  verifyGoogleConnection,
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
import {
  exchangePayboxCode,
  storePayboxTokens,
} from '@/lib/integrations/paybox'

import {
  completeConnectByState,
  bindSpectrumIdentity,
} from '@/lib/connect-token'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
): Promise<NextResponse> {
  const { provider } = await params
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

  // --- In-thread connect flow: no web session; the one-use connect token
  // consumed at the start is bound to the `state` Google echoes back. ---
  if (provider === 'google' && state && !request.cookies.get('g_oauth_state')) {
    return handleGoogleConnectCallback(code, state, appUrl)
  }

  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(`${appUrl}/onboarding`)
  }

  // CSRF check for the session flow: state must round-trip from our cookie.
  if (provider === 'google') {
    const expectedState = request.cookies.get('g_oauth_state')?.value
    if (!expectedState || !state || expectedState !== state) {
      return NextResponse.redirect(`${appUrl}/onboarding?error=oauth_state_mismatch`)
    }
  }

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

      case 'paybox': {
        // Retrieve PKCE verifier + client_id stashed at the start of the flow
        const { cookies } = await import('next/headers')
        const cookieStore = await cookies()
        const codeVerifier = cookieStore.get('paybox_cv')?.value
        const clientId = cookieStore.get('paybox_client_id')?.value
        if (!codeVerifier || !clientId) {
          return NextResponse.redirect(`${appUrl}/onboarding?error=paybox_pkce_expired`)
        }

        const result = await exchangePayboxCode(code, codeVerifier, clientId)
        await storePayboxTokens(session.userId, result, clientId)

        cookieStore.delete('paybox_cv')
        cookieStore.delete('paybox_client_id')
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

/**
 * Complete an in-thread (connect-token) Google flow: verify the live
 * connection BEFORE claiming success, then confirm in-thread and resume
 * the original request (telegram directly; imessage via the Spectrum
 * process's resume poll).
 */
async function handleGoogleConnectCallback(
  code: string | null,
  state: string,
  appUrl: string
): Promise<NextResponse> {
  const { logger } = await import('@/lib/logger')

  if (!code) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=connect_no_code`)
  }

  const connect = await completeConnectByState(state)
  if (!connect) {
    return NextResponse.redirect(`${appUrl}/onboarding?error=connect_state_invalid`)
  }

  try {
    const result = await exchangeGoogleCode(code)

    // Bind the chat identity to a Dock user before storing tokens.
    let userId: string | null = null
    if (connect.platform === 'imessage') {
      userId = await bindSpectrumIdentity(connect.chatId)
    } else {
      const { getOrCreateUserByTelegramId } = await import('@/lib/connect-user')
      userId = await getOrCreateUserByTelegramId(BigInt(connect.chatId))
    }
    if (!userId) {
      logger.error('connect flow: failed to bind identity', { platform: connect.platform })
      return NextResponse.redirect(`${appUrl}/onboarding?error=connect_identity_failed`)
    }

    await storeGoogleTokens(
      userId,
      result.accessToken,
      result.refreshToken,
      result.expiresAt,
      ['gmail.readonly', 'gmail.send', 'gmail.modify', 'calendar.readonly', 'calendar.events'],
      result.email
    )

    // Never claim connected until a live call against the fresh tokens passes.
    const verified = await verifyGoogleConnection(result.accessToken, result.refreshToken)
    if (!verified) {
      logger.error('connect flow: live verification failed', { platform: connect.platform })
      await notifyConnectFailure(connect)
      return NextResponse.redirect(`${appUrl}/onboarding?error=connect_verification_failed`)
    }

    await notifyConnectSuccess(connect)
    return NextResponse.redirect(`${appUrl}/onboarding?connected=google&via=chat`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('connect flow callback error', { error: message })
    await notifyConnectFailure(connect)
    return NextResponse.redirect(`${appUrl}/onboarding?error=connect_failed`)
  }
}

interface ConnectOutcome {
  platform: 'telegram' | 'imessage'
  chatId: string
  pendingRequest: string | null
}

async function notifyConnectSuccess(connect: ConnectOutcome): Promise<void> {
  if (connect.platform === 'telegram') {
    const { sendMessage } = await import('@/lib/telegram/client')
    await sendMessage({ chatId: Number(connect.chatId), text: 'google connected ✓' })
    if (connect.pendingRequest) {
      const { handleTelegramUpdate } = await import('@/lib/orchestrator')
      await handleTelegramUpdate({
        message: {
          message_id: 0,
          chat: { id: Number(connect.chatId), type: 'private' },
          date: Math.floor(Date.now() / 1000),
          text: connect.pendingRequest,
          from: { id: Number(connect.chatId), is_bot: false, first_name: '' },
        },
      } as never)
    }
  }
  // imessage: the Spectrum process polls claimPendingResume(chatGuid) and
  // sends the confirmation + resumed answer itself.
}

async function notifyConnectFailure(connect: ConnectOutcome): Promise<void> {
  if (connect.platform === 'telegram') {
    const { sendMessage } = await import('@/lib/telegram/client')
    await sendMessage({
      chatId: Number(connect.chatId),
      text: "google connect didn't go through — try again and i'll send a fresh link",
    })
  }
}
