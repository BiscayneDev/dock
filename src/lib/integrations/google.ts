import { extraGoogleProvider } from './google-accounts'
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

/**
 * Scopes requested from Google. `openid` + `email` identity scopes back the
 * userinfo call in exchangeCode(); the gmail/calendar scopes are the actual
 * tool permissions (least-privilege — see spec §4).
 */
export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

/**
 * `forceConsent` must be true on the FIRST connect — the consent prompt is
 * what yields a refresh token. Re-auths of an already-connected account skip
 * the consent screen: no reason to re-prompt for grants already made.
 */
export function getAuthUrl(
  scopes: string[],
  state?: string,
  opts?: { forceConsent?: boolean; selectAccount?: boolean }
): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    // select_account shows Google's account picker, so a second Gmail can be added.
    ...(opts?.forceConsent || opts?.selectAccount
      ? { prompt: [opts?.selectAccount ? 'select_account' : '', opts?.forceConsent ? 'consent' : ''].filter(Boolean).join(' ') }
      : {}),
    scope: scopes,
    ...(state ? { state } : {}),
  })
}

/**
 * Whether a Google connection (with refresh token) already exists for a user.
 * Drives the conditional consent prompt: first connect → consent; reconnect → skip.
 */
export async function hasStoredGoogleConnection(userId: string): Promise<boolean> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('oauth_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .eq('provider', 'google')
    .maybeSingle()
  return !!(data?.refresh_token as string | undefined)
}

/**
 * Cheap live check that the freshly granted tokens actually work.
 * Never claim a connection is complete without this passing.
 */
export async function verifyGoogleConnection(accessToken: string, refreshToken: string | null): Promise<boolean> {
  try {
    const client = getOAuth2Client()
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
    const gmail = google.gmail({ version: 'v1', auth: client })
    await gmail.users.labels.list({ userId: 'me' })
    return true
  } catch {
    return false
  }
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
        .eq('provider', tokens.provider ?? 'google')
    }
  }

  return client
}

/**
 * Store a Google connection. Accounts are keyed by Gmail address: the same
 * address refreshes its row, a new address is ADDED (never replaces the
 * existing one). The first account is the primary ('google'); later ones
 * are 'google:<email>'.
 */
export async function storeGoogleTokens(
  userId: string,
  accessToken: string,
  refreshToken: string | null,
  expiresAt: Date | null,
  scopes: string[],
  email: string | null
): Promise<{ provider: string; added: boolean }> {
  const supabase = createServerClient()
  const addr = email?.trim().toLowerCase() || null

  const { data: rows, error: readErr } = await supabase
    .from('oauth_tokens')
    .select('id, provider, provider_account_email, refresh_token')
    .eq('user_id', userId)
    .or('provider.eq.google,provider.like.google:*')
  if (readErr) throw new Error(`Failed to read Google tokens: ${readErr.message}`)
  const existing = (rows ?? []) as { id: string; provider: string; provider_account_email: string | null; refresh_token: string | null }[]

  // Same account (or an old row with no recorded email while it's the only one): update in place.
  const same =
    existing.find((r) => addr && r.provider_account_email?.toLowerCase() === addr) ??
    (existing.length === 1 && !existing[0].provider_account_email ? existing[0] : undefined) ??
    (!addr && existing.length ? existing.find((r) => r.provider === 'google') : undefined)

  const tokenData = {
    access_token: encryptTokenForDb(accessToken),
    // Google omits refresh_token on re-consent sometimes; keep the stored one.
    ...(refreshToken ? { refresh_token: encryptTokenForDb(refreshToken) } : {}),
    expires_at: expiresAt?.toISOString() ?? null,
    scopes,
    provider_account_email: addr,
    updated_at: new Date().toISOString(),
  }

  if (same) {
    const { error } = await supabase.from('oauth_tokens').update(tokenData).eq('id', same.id)
    if (error) throw new Error(`Failed to store Google tokens: ${error.message}`)
    return { provider: same.provider, added: false }
  }

  const provider = existing.some((r) => r.provider === 'google') && addr ? extraGoogleProvider(addr) : 'google'
  const { error } = await supabase
    .from('oauth_tokens')
    .insert({ user_id: userId, provider, refresh_token: null, ...tokenData })
  if (error) throw new Error(`Failed to store Google tokens: ${error.message}`)
  return { provider, added: true }
}

/** Make one connected Google account the primary (migration 047 swaps providers atomically). */
export async function setPrimaryGoogleAccount(userId: string, email: string): Promise<boolean> {
  const { data, error } = await createServerClient().rpc('set_primary_google', { p_user_id: userId, p_email: email.trim().toLowerCase() })
  if (error) throw new Error(`Failed to set primary Google account: ${error.message}`)
  return Boolean(data)
}

/**
 * Remove one connected Google account. Disconnecting the primary promotes
 * another account first so 'google' stays populated while any remain.
 * Returns false when the email isn't connected.
 */
export async function disconnectGoogleAccount(userId: string, email: string): Promise<boolean> {
  const supabase = createServerClient()
  const target = email.trim().toLowerCase()
  const { data: rows, error } = await supabase
    .from('oauth_tokens')
    .select('provider, provider_account_email')
    .eq('user_id', userId)
    .like('provider', 'google%')
  if (error) throw new Error(`Failed to load Google accounts: ${error.message}`)
  const accounts = (rows ?? []).filter((r) => r.provider === 'google' || String(r.provider).startsWith('google:'))
  const hit = accounts.find((r) => String(r.provider_account_email ?? '').toLowerCase() === target)
  if (!hit) return false
  let provider = hit.provider as string
  if (provider === 'google') {
    const next = accounts.find((r) => r.provider !== 'google' && r.provider_account_email)
    if (next) {
      await setPrimaryGoogleAccount(userId, String(next.provider_account_email))
      provider = extraGoogleProvider(target)
    }
  }
  const { error: delErr } = await supabase.from('oauth_tokens').delete().eq('user_id', userId).eq('provider', provider)
  if (delErr) throw new Error(`Failed to disconnect ${target}: ${delErr.message}`)
  return true
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
