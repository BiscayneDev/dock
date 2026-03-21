import { Octokit } from '@octokit/rest'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import type { DecryptedTokens } from '@/lib/llm/types'

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'

export function getAuthUrl(scopes: string[] = ['repo', 'notifications']): string {
  const clientId = process.env.GITHUB_CLIENT_ID
  const redirectUri = process.env.GITHUB_REDIRECT_URI

  const params = new URLSearchParams({
    client_id: clientId ?? '',
    redirect_uri: redirectUri ?? '',
    scope: scopes.join(' '),
  })

  return `${GITHUB_AUTH_URL}?${params.toString()}`
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string
  username: string | null
}> {
  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: process.env.GITHUB_REDIRECT_URI,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }

  if (data.error || !data.access_token) {
    throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error ?? 'Unknown error'}`)
  }

  // Fetch username
  let username: string | null = null
  try {
    const octokit = new Octokit({ auth: data.access_token })
    const user = await octokit.users.getAuthenticated()
    username = user.data.login
  } catch {
    // Non-critical
  }

  return {
    accessToken: data.access_token,
    username,
  }
}

export function getOctokitClient(tokens: DecryptedTokens): Octokit {
  return new Octokit({ auth: tokens.accessToken })
}

export async function storeGithubTokens(
  userId: string,
  accessToken: string,
  username: string | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'github',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: null,
    expires_at: null,
    scopes: ['repo', 'notifications'],
    provider_account_id: username,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store GitHub tokens: ${error.message}`)
  }
}

export async function getDecryptedGithubTokens(userId: string): Promise<DecryptedTokens | null> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'github')
    .single()

  if (error || !data) {
    return null
  }

  return {
    accessToken: decryptTokenFromDb(data.access_token),
    refreshToken: null,
    expiresAt: null,
  }
}
