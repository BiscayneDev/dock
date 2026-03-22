import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens } from '@/lib/llm/types'

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const WHOOP_API_BASE = 'https://api.prod.whoop.com/developer/v1'

export function getWhoopAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID ?? '',
    redirect_uri: process.env.WHOOP_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline',
    state: 'whoop_dock_auth',
  })

  return `${WHOOP_AUTH_URL}?${params.toString()}`
}

export async function exchangeWhoopCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.WHOOP_CLIENT_ID ?? '',
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? '',
      redirect_uri: process.env.WHOOP_REDIRECT_URI ?? '',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`WHOOP token exchange failed: ${text}`)
  }

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
  }
}

async function refreshWhoopToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}> {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID ?? '',
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? '',
    }),
  })

  if (!response.ok) {
    throw new Error('WHOOP token refresh failed')
  }

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
  }
}

export async function getWhoopAccessToken(
  tokens: DecryptedTokens,
  userId: string
): Promise<string> {
  if (tokens.expiresAt && tokens.refreshToken) {
    const expiresAt = new Date(tokens.expiresAt)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

    if (expiresAt < fiveMinFromNow) {
      try {
        const refreshed = await refreshWhoopToken(tokens.refreshToken)

        const supabase = createServerClient()
        const updates: Record<string, unknown> = {
          access_token: encryptTokenForDb(refreshed.accessToken),
          updated_at: new Date().toISOString(),
        }

        if (refreshed.expiresAt) {
          updates.expires_at = refreshed.expiresAt.toISOString()
        }
        if (refreshed.refreshToken) {
          updates.refresh_token = encryptTokenForDb(refreshed.refreshToken)
        }

        await supabase
          .from('oauth_tokens')
          .update(updates)
          .eq('user_id', userId)
          .eq('provider', 'whoop')

        return refreshed.accessToken
      } catch (err) {
        logger.error('WHOOP token refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return tokens.accessToken
}

export async function whoopFetch(
  path: string,
  tokens: DecryptedTokens,
  userId: string,
  params?: Record<string, string>
): Promise<unknown> {
  const accessToken = await getWhoopAccessToken(tokens, userId)
  const url = new URL(`${WHOOP_API_BASE}${path}`)

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`WHOOP API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function storeWhoopTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'whoop',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: refreshToken ? encryptTokenForDb(refreshToken) : null,
    expires_at: expiresAt?.toISOString() ?? null,
    scopes: ['read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'read:profile'],
    provider_account_email: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store WHOOP tokens: ${error.message}`)
  }
}
