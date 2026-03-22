import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens } from '@/lib/llm/types'

const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize'
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token'
const OURA_API_BASE = 'https://api.ouraring.com/v2'

export function getOuraAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.OURA_CLIENT_ID ?? '',
    redirect_uri: process.env.OURA_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'daily personal heartrate session tag workout',
    state: 'oura',
  })

  return `${OURA_AUTH_URL}?${params.toString()}`
}

export async function exchangeOuraCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}> {
  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.OURA_CLIENT_ID ?? '',
      client_secret: process.env.OURA_CLIENT_SECRET ?? '',
      redirect_uri: process.env.OURA_REDIRECT_URI ?? '',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Oura token exchange failed: ${text}`)
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

async function refreshOuraToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}> {
  const response = await fetch(OURA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.OURA_CLIENT_ID ?? '',
      client_secret: process.env.OURA_CLIENT_SECRET ?? '',
    }),
  })

  if (!response.ok) {
    throw new Error('Oura token refresh failed')
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

// Get a valid access token, refreshing if needed
export async function getOuraAccessToken(
  tokens: DecryptedTokens,
  userId: string
): Promise<string> {
  // Check if token needs refresh (within 5 minutes of expiry)
  if (tokens.expiresAt && tokens.refreshToken) {
    const expiresAt = new Date(tokens.expiresAt)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

    if (expiresAt < fiveMinFromNow) {
      try {
        const refreshed = await refreshOuraToken(tokens.refreshToken)

        // Write refreshed tokens back to DB
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
          .eq('provider', 'oura')

        return refreshed.accessToken
      } catch (err) {
        logger.error('Oura token refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return tokens.accessToken
}

// Make an authenticated request to the Oura API
export async function ouraFetch(
  path: string,
  tokens: DecryptedTokens,
  userId: string,
  params?: Record<string, string>
): Promise<unknown> {
  const accessToken = await getOuraAccessToken(tokens, userId)
  const url = new URL(`${OURA_API_BASE}${path}`)

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Oura API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function storeOuraTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'oura',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: refreshToken ? encryptTokenForDb(refreshToken) : null,
    expires_at: expiresAt?.toISOString() ?? null,
    scopes: ['daily', 'personal', 'heartrate', 'session', 'tag', 'workout'],
    provider_account_email: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store Oura tokens: ${error.message}`)
  }
}
