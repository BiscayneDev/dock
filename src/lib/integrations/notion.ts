import { Client } from '@notionhq/client'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import type { DecryptedTokens } from '@/lib/llm/types'

const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize'
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'

export function getAuthUrl(): string {
  const clientId = process.env.NOTION_CLIENT_ID
  const redirectUri = process.env.NOTION_REDIRECT_URI

  return `${NOTION_AUTH_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri ?? '')}&response_type=code&owner=user`
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string
  workspaceName: string | null
}> {
  const clientId = process.env.NOTION_CLIENT_ID
  const clientSecret = process.env.NOTION_CLIENT_SECRET

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  const response = await fetch(NOTION_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Notion token exchange failed: ${text}`)
  }

  const data = (await response.json()) as {
    access_token: string
    workspace_name?: string
  }

  return {
    accessToken: data.access_token,
    workspaceName: data.workspace_name ?? null,
  }
}

export function getNotionClient(tokens: DecryptedTokens): Client {
  return new Client({ auth: tokens.accessToken })
}

export async function storeNotionTokens(
  userId: string,
  accessToken: string,
  workspaceName: string | null
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'notion',
    access_token: encryptTokenForDb(accessToken),
    refresh_token: null,
    expires_at: null,
    scopes: null,
    provider_account_email: workspaceName,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store Notion tokens: ${error.message}`)
  }
}

export async function getDecryptedNotionTokens(userId: string): Promise<DecryptedTokens | null> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'notion')
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
