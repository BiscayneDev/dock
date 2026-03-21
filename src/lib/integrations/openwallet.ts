import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens } from '@/lib/llm/types'

// OpenWallet Standard (OWS) REST API client
// Users run OWS locally or on a server and provide the endpoint URL + API key.
// Docs: https://openwallet.sh/

interface OWSClientConfig {
  endpoint: string  // e.g. "http://localhost:8787" or a tunnel URL
  apiKey: string
}

interface OWSResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

export class OWSClient {
  private endpoint: string
  private apiKey: string

  constructor(config: OWSClientConfig) {
    // Strip trailing slash
    this.endpoint = config.endpoint.replace(/\/+$/, '')
    this.apiKey = config.apiKey
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<OWSResponse<T>> {
    try {
      const response = await fetch(`${this.endpoint}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const text = await response.text()
        logger.error('OWS API error', { status: response.status, path })
        return { ok: false, error: `OWS API error (${response.status}): ${text}` }
      }

      const data = (await response.json()) as T
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error('OWS request failed', { path, error: message })
      return { ok: false, error: `Failed to connect to OWS: ${message}` }
    }
  }

  // --- Wallet operations ---

  async listWallets(): Promise<OWSResponse> {
    return this.request('GET', '/v1/wallets')
  }

  async getWallet(walletId: string): Promise<OWSResponse> {
    return this.request('GET', `/v1/wallets/${walletId}`)
  }

  async listAccounts(walletId: string): Promise<OWSResponse> {
    return this.request('GET', `/v1/wallets/${walletId}/accounts`)
  }

  async getBalance(accountId: string, chainId: string): Promise<OWSResponse> {
    return this.request('GET', `/v1/accounts/${accountId}/balance?chain=${chainId}`)
  }

  async signMessage(
    walletId: string,
    chainId: string,
    message: string
  ): Promise<OWSResponse> {
    return this.request('POST', `/v1/wallets/${walletId}/sign-message`, {
      chain: chainId,
      message,
    })
  }

  async signTransaction(
    walletId: string,
    chainId: string,
    transaction: Record<string, unknown>
  ): Promise<OWSResponse> {
    return this.request('POST', `/v1/wallets/${walletId}/sign`, {
      chain: chainId,
      transaction,
    })
  }

  async signAndSend(
    walletId: string,
    chainId: string,
    transaction: Record<string, unknown>
  ): Promise<OWSResponse> {
    return this.request('POST', `/v1/wallets/${walletId}/sign-and-send`, {
      chain: chainId,
      transaction,
    })
  }

  async simulate(
    walletId: string,
    chainId: string,
    transaction: Record<string, unknown>
  ): Promise<OWSResponse> {
    return this.request('POST', `/v1/wallets/${walletId}/simulate`, {
      chain: chainId,
      transaction,
    })
  }
}

// --- Token storage (reuses oauth_tokens table with provider='openwallet') ---
// We store: access_token = encrypted API key, provider_account_id = endpoint URL

export function getOWSClient(tokens: DecryptedTokens): OWSClient {
  // For OWS, accessToken = API key, expiresAt = endpoint URL (repurposed field)
  // TODO: Consider a dedicated field for endpoint URL if this pattern causes confusion
  if (!tokens.expiresAt) {
    throw new Error('OpenWallet endpoint URL not configured')
  }

  return new OWSClient({
    endpoint: tokens.expiresAt, // Stored in expires_at field as string
    apiKey: tokens.accessToken,
  })
}

export async function storeOWSCredentials(
  userId: string,
  apiKey: string,
  endpoint: string
): Promise<void> {
  const supabase = createServerClient()

  const tokenData = {
    user_id: userId,
    provider: 'openwallet',
    access_token: encryptTokenForDb(apiKey),
    refresh_token: null,
    expires_at: endpoint, // Store endpoint URL here
    scopes: null,
    provider_account_id: endpoint,
    provider_account_email: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('oauth_tokens')
    .upsert(tokenData, { onConflict: 'user_id,provider' })

  if (error) {
    throw new Error(`Failed to store OpenWallet credentials: ${error.message}`)
  }
}

export async function getDecryptedOWSTokens(userId: string): Promise<DecryptedTokens | null> {
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at, provider_account_id')
    .eq('user_id', userId)
    .eq('provider', 'openwallet')
    .single()

  if (error || !data) {
    return null
  }

  return {
    accessToken: decryptTokenFromDb(data.access_token as string),
    refreshToken: null,
    expiresAt: data.provider_account_id as string, // endpoint URL
  }
}

export async function removeOWSCredentials(userId: string): Promise<void> {
  const supabase = createServerClient()

  await supabase
    .from('oauth_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'openwallet')
}
