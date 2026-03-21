import { google } from 'googleapis'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import type { DecryptedTokens } from '@/lib/llm/types'

export function getOAuth2Client(): InstanceType<typeof google.auth.OAuth2> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )
}

export function getAuthUrl(scopes: string[]): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  })
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  email: string | null
}> {
  const client = getOAuth2Client()
  const { tokens } = await client.getToken(code)

  client.setCredentials(tokens)

  let email: string | null = null
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client })
    const userInfo = await oauth2.userinfo.get()
    email = userInfo.data.email ?? null
  } catch {
    // Non-critical — email is optional metadata
  }

  return {
    accessToken: tokens.access_token ?? '',
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    email,
  }
}

export async function getAuthedClient(
  tokens: DecryptedTokens,
  userId: string
): Promise<InstanceType<typeof google.auth.OAuth2>> {
  const client = getOAuth2Client()

  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })

  // Refresh if token expires within 5 minutes
  if (tokens.expiresAt) {
    const expiresAt = new Date(tokens.expiresAt)
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)

    if (expiresAt < fiveMinFromNow && tokens.refreshToken) {
      const { credentials } = await client.refreshAccessToken()
      client.setCredentials(credentials)

      // Write refreshed tokens back to DB
      const supabase = createServerClient()
      const updates: Record<string, unknown> = {
        access_token: encryptTokenForDb(credentials.access_token ?? ''),
        updated_at: new Date().toISOString(),
      }

      if (credentials.expiry_date) {
        updates.expires_at = new Date(credentials.expiry_date).toISOString()
      }
      if (credentials.refresh_token) {
        updates.refresh_token = encryptTokenForDb(credentials.refresh_token)
      }

      await supabase
        .from('oauth_tokens')
        .update(updates)
        .eq('user_id', userId)
        .eq('provider', 'google')
    }
  }

  return client
}

export async function storeGoogleTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  scopes: string[],
  email: string | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'google',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: refreshToken ? encryptTokenForDb(refreshToken) : null,
    expires_at: expiresAt?.toISOString() ?? null,
    scopes,
    provider_account_email: email,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store Google tokens: ${error.message}`)
  }
}

export async function getDecryptedGoogleTokens(userId: string): Promise<DecryptedTokens | null> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .single()

  if (error || !data) {
    return null
  }

  return {
    accessToken: decryptTokenFromDb(data.access_token),
    refreshToken: data.refresh_token ? decryptTokenFromDb(data.refresh_token) : null,
    expiresAt: data.expires_at,
  }
}
