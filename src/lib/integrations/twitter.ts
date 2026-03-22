import { createHash, randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens } from '@/lib/llm/types'

const TWITTER_AUTH_URL = 'https://twitter.com/i/oauth2/authorize'
const TWITTER_TOKEN_URL = 'https://api.x.com/2/oauth2/token'
const TWITTER_API_BASE = 'https://api.x.com/2'

const SCOPES = ['tweet.read', 'users.read', 'offline.access', 'bookmark.read']

// --- PKCE helpers ---

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// --- OAuth flow ---

export function getTwitterAuthUrl(codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.TWITTER_CLIENT_ID ?? '',
    redirect_uri: process.env.TWITTER_REDIRECT_URI ?? '',
    scope: SCOPES.join(' '),
    state: 'twitter',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })

  return `${TWITTER_AUTH_URL}?${params.toString()}`
}

export async function exchangeTwitterCode(
  code: string,
  codeVerifier: string
): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  userId: string | null
  username: string | null
}> {
  const clientId = process.env.TWITTER_CLIENT_ID ?? ''
  const clientSecret = process.env.TWITTER_CLIENT_SECRET ?? ''

  const response = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.TWITTER_REDIRECT_URI ?? '',
      code_verifier: codeVerifier,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Twitter token exchange failed: ${text}`)
  }

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  // Fetch the authenticated user's info
  let userId: string | null = null
  let username: string | null = null

  try {
    const meRes = await fetch(`${TWITTER_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })

    if (meRes.ok) {
      const meData = await meRes.json() as { data: { id: string; username: string } }
      userId = meData.data.id
      username = meData.data.username
    }
  } catch {
    // Non-critical
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
    userId,
    username,
  }
}

async function refreshTwitterToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}> {
  const clientId = process.env.TWITTER_CLIENT_ID ?? ''
  const clientSecret = process.env.TWITTER_CLIENT_SECRET ?? ''

  const response = await fetch(TWITTER_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  })

  if (!response.ok) {
    throw new Error('Twitter token refresh failed')
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

export async function getTwitterAccessToken(
  tokens: DecryptedTokens,
  userId: string
): Promise<string> {
  // Twitter tokens expire in 2 hours — refresh if within 5 minutes of expiry
  if (tokens.expiresAt && tokens.refreshToken) {
    const expiresAt = new Date(tokens.expiresAt)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

    if (expiresAt < fiveMinFromNow) {
      try {
        const refreshed = await refreshTwitterToken(tokens.refreshToken)

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
          .eq('provider', 'twitter')

        return refreshed.accessToken
      } catch (err) {
        logger.error('Twitter token refresh failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return tokens.accessToken
}

// Make an authenticated request to the Twitter API v2
export async function twitterFetch(
  path: string,
  tokens: DecryptedTokens,
  userId: string,
  params?: Record<string, string>
): Promise<unknown> {
  const accessToken = await getTwitterAccessToken(tokens, userId)
  const url = new URL(`${TWITTER_API_BASE}${path}`)

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Twitter API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

export async function storeTwitterTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  twitterUserId: string | null,
  username: string | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'twitter',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: refreshToken ? encryptTokenForDb(refreshToken) : null,
    expires_at: expiresAt?.toISOString() ?? null,
    scopes: SCOPES,
    provider_account_id: twitterUserId,
    provider_account_email: username ? `@${username}` : null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store Twitter tokens: ${error.message}`)
  }
}
