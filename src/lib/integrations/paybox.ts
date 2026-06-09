import { createHash, randomBytes } from 'crypto'
import { PayboxClient as PayboxSdk } from '@paybox-sh/sdk'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb, decryptTokenFromDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens, ToolResult, UserContext } from '@/lib/llm/types'

// Paybox — a passkey-gated credential vault for AI agents.
// Docs: https://docs.paybox.sh/  SDK: @paybox-sh/sdk
//
// The developer surface is OAuth 2.1 (authorize) -> the Paybox agent API. Paybox
// is NOT a writable secret store; credentials are vaulted by the user in the
// Paybox app. Dock connects as a public OAuth client and drives the official
// SDK (REST /agent/* over the same bearer token) on the user's behalf. Wallet
// signing is non-custodial and runs in-process via a `pbxk1.` signing key the
// user provisions in the Paybox app; the MoonX secret never reaches Dock.

const DEFAULT_API_URL = 'https://api.paybox.sh'
const DEFAULT_APP_URL = 'https://app.paybox.sh'

export function getPayboxApiUrl(): string {
  return (process.env.PAYBOX_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')
}

export function getPayboxAppUrl(): string {
  return (process.env.PAYBOX_APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, '')
}

function getMcpResource(): string {
  return `${getPayboxApiUrl()}/mcp`
}

function getRedirectUri(): string {
  return (
    process.env.PAYBOX_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback/paybox`
  )
}

const SCOPES = ['mcp', 'offline_access']

// --- PKCE helpers ---

export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// --- OAuth 2.1 server metadata (RFC 8414) ---

interface AuthServerMetadata {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
}

// Discover endpoints; fall back to the conventional paths if discovery fails so
// a transient metadata hiccup doesn't break the flow.
export async function getAuthServerMetadata(): Promise<AuthServerMetadata> {
  const base = getPayboxApiUrl()
  const fallback: AuthServerMetadata = {
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
  }

  try {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return fallback
    const data = (await res.json()) as Partial<AuthServerMetadata>
    return {
      authorization_endpoint: data.authorization_endpoint ?? fallback.authorization_endpoint,
      token_endpoint: data.token_endpoint ?? fallback.token_endpoint,
      registration_endpoint: data.registration_endpoint ?? fallback.registration_endpoint,
    }
  } catch {
    return fallback
  }
}

// --- Dynamic client registration (RFC 7591) ---

// Paybox supports public clients only (no client secret). Reuse an app-wide
// client via PAYBOX_CLIENT_ID if set; otherwise register one dynamically.
export async function getOrRegisterClientId(): Promise<string> {
  const envClientId = process.env.PAYBOX_CLIENT_ID
  if (envClientId) return envClientId

  const { registration_endpoint } = await getAuthServerMetadata()
  const res = await fetch(registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Dock',
      redirect_uris: [getRedirectUri()],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Paybox client registration failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { client_id?: string }
  if (!data.client_id) {
    throw new Error('Paybox client registration returned no client_id')
  }
  return data.client_id
}

// --- Authorization URL ---

export function getPayboxAuthUrl(clientId: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    scope: SCOPES.join(' '),
    resource: getMcpResource(),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: 'paybox',
  })

  return `${getPayboxApiUrl()}/oauth/authorize?${params.toString()}`
}

// --- Token exchange / refresh (public client: no secret) ---

interface TokenResult {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

function parseTokenResponse(data: {
  access_token: string
  refresh_token?: string
  expires_in?: number
}): TokenResult {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
  }
}

export async function exchangePayboxCode(
  code: string,
  codeVerifier: string,
  clientId: string
): Promise<TokenResult> {
  const { token_endpoint } = await getAuthServerMetadata()

  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Paybox token exchange failed: ${res.status} ${text}`)
  }

  return parseTokenResponse(await res.json())
}

async function refreshPayboxToken(
  refreshToken: string,
  clientId: string
): Promise<TokenResult> {
  const { token_endpoint } = await getAuthServerMetadata()

  const res = await fetch(token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Paybox token refresh failed: ${res.status} ${text}`)
  }

  return parseTokenResponse(await res.json())
}

// --- Token storage (oauth_tokens, provider='paybox') ---
// access_token / refresh_token encrypted; provider_account_id holds the OAuth
// client_id so refresh works for dynamically-registered clients.

export async function storePayboxTokens(
  userId: string,
  result: TokenResult,
  clientId: string
): Promise<void> {
  const supabase = createServerClient()

  const { error } = await supabase.from('oauth_tokens').upsert(
    {
      user_id: userId,
      provider: 'paybox',
      access_token: encryptTokenForDb(result.accessToken),
      refresh_token: result.refreshToken ? encryptTokenForDb(result.refreshToken) : null,
      expires_at: result.expiresAt?.toISOString() ?? null,
      scopes: SCOPES,
      provider_account_id: clientId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  )

  if (error) {
    throw new Error(`Failed to store Paybox tokens: ${error.message}`)
  }
}

// Load the user's decrypted Paybox tokens (for building an SDK client outside
// the agent's UserContext, e.g. in API routes).
export async function getDecryptedPayboxTokens(userId: string): Promise<DecryptedTokens | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'paybox')
    .single()

  if (!data?.access_token) return null
  return {
    accessToken: decryptTokenFromDb(data.access_token as string),
    refreshToken: data.refresh_token ? decryptTokenFromDb(data.refresh_token as string) : null,
    expiresAt: (data.expires_at as string) ?? null,
  }
}

// Pull the wallet credentials (address + chains) the client may use — for the
// fund/deposit flow.
export interface PayboxWallet {
  credentialId: string
  name: string
  address: string | null
  chains: string[]
}

export async function getPayboxWallets(sdk: PayboxSdk): Promise<PayboxWallet[]> {
  const creds = await sdk.listCredentials()
  return creds
    .filter((c) => c.credential.credential_type === 'wallet')
    .map((c) => {
      const meta = (c.credential.metadata ?? {}) as Record<string, unknown>
      return {
        credentialId: c.credential.id,
        name: c.credential.name,
        address: (meta.address as string | null) ?? null,
        chains: Array.isArray(meta.chains) ? (meta.chains as string[]) : [],
      }
    })
}

// Returns a valid access token, refreshing (and persisting the rotated refresh
// token — Paybox rotates on every use) when within 5 minutes of expiry.
export async function getPayboxAccessToken(
  tokens: DecryptedTokens,
  userId: string
): Promise<string> {
  if (!tokens.expiresAt || !tokens.refreshToken) {
    return tokens.accessToken
  }

  const expiresAt = new Date(tokens.expiresAt)
  const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
  if (expiresAt >= fiveMinFromNow) {
    return tokens.accessToken
  }

  const supabase = createServerClient()

  // client_id lives in provider_account_id (or an app-wide env client).
  let clientId = process.env.PAYBOX_CLIENT_ID
  if (!clientId) {
    const { data } = await supabase
      .from('oauth_tokens')
      .select('provider_account_id')
      .eq('user_id', userId)
      .eq('provider', 'paybox')
      .single()
    clientId = (data?.provider_account_id as string | undefined) ?? undefined
  }
  if (!clientId) {
    logger.error('Paybox refresh skipped: no client_id on record', { userId })
    return tokens.accessToken
  }

  try {
    const refreshed = await refreshPayboxToken(tokens.refreshToken, clientId)

    const updates: Record<string, unknown> = {
      access_token: encryptTokenForDb(refreshed.accessToken),
      updated_at: new Date().toISOString(),
    }
    if (refreshed.expiresAt) updates.expires_at = refreshed.expiresAt.toISOString()
    // Always persist the rotated refresh token; the old one is now spent.
    if (refreshed.refreshToken) {
      updates.refresh_token = encryptTokenForDb(refreshed.refreshToken)
    }

    await supabase
      .from('oauth_tokens')
      .update(updates)
      .eq('user_id', userId)
      .eq('provider', 'paybox')

    return refreshed.accessToken
  } catch (err) {
    logger.error('Paybox token refresh failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return tokens.accessToken
  }
}

// --- Signing key (pbxk1.) storage ---
// Enables in-process, non-custodial wallet signing (sign/swap). Stored
// encrypted in the paybox token row's `signing_key` column (migration 005).
// Reads are tolerant: if the column/key is absent, sign/swap simply stall at
// pending_signature rather than erroring.

export async function getPayboxSigningKey(userId: string): Promise<string | null> {
  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('signing_key')
      .eq('user_id', userId)
      .eq('provider', 'paybox')
      .single()
    if (error || !data?.signing_key) return null
    return decryptTokenFromDb(data.signing_key as string)
  } catch {
    return null
  }
}

export async function storePayboxSigningKey(userId: string, signingKey: string): Promise<void> {
  const supabase = createServerClient()
  const { error } = await supabase
    .from('oauth_tokens')
    .update({ signing_key: encryptTokenForDb(signingKey), updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'paybox')

  if (error) {
    throw new Error(
      `Failed to store Paybox signing key: ${error.message}. ` +
        `Ensure migration 005_paybox_signing_key.sql is applied.`
    )
  }
}

export async function removePayboxSigningKey(userId: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('oauth_tokens')
    .update({ signing_key: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('provider', 'paybox')
}

// --- SDK client ---

// Build the official SDK client bound to a user: a fresh OAuth bearer token, and
// the signing key when present (enables in-process sign/swap).
export async function getPayboxSdk(
  tokens: DecryptedTokens,
  userId: string
): Promise<PayboxSdk> {
  const [token, signingKey] = await Promise.all([
    getPayboxAccessToken(tokens, userId),
    getPayboxSigningKey(userId),
  ])
  return new PayboxSdk({
    baseUrl: getPayboxApiUrl(),
    token,
    signingKey: signingKey ?? undefined,
  })
}

// Map the SDK's AgentResponse to a ToolResult, honouring the submit-once-then-
// poll lifecycle. AgentResponse = { request_id, status, output, approval_id,
// error }; the artifact lives on output.value.
interface AgentResponseLike {
  request_id: string
  status: 'pending_approval' | 'pending_signature' | 'success' | 'denied' | 'error'
  output: { value?: unknown } | null
  approval_id: string | null
  error: string | null
}

export function agentResultToTool(resp: AgentResponseLike): ToolResult {
  switch (resp.status) {
    case 'success':
      return { success: true, data: { status: 'success', output: resp.output?.value ?? null } }
    case 'pending_approval':
      return {
        success: true,
        data: {
          status: 'pending_approval',
          request_id: resp.request_id,
          approval_id: resp.approval_id,
          instruction:
            `Tell the user to open the Paybox app (${getPayboxAppUrl()}) and approve ` +
            `the pending request with their passkey, then call paybox_get_request with ` +
            `this request_id. Do NOT re-issue the original request.`,
        },
      }
    case 'pending_signature':
      return {
        success: true,
        data: {
          status: 'pending_signature',
          request_id: resp.request_id,
          instruction:
            `Cleared to sign but no in-process signing key is configured (or the signing ` +
            `window must finish). Ask the user to add their Paybox signing key in The ` +
            `Harbor, then poll paybox_get_request with this request_id.`,
        },
      }
    case 'denied':
      return { success: false, error: `Denied: ${resp.error ?? 'no reason given'}` }
    default:
      return { success: false, error: resp.error ?? 'Paybox returned an error' }
  }
}

// --- Capability gate ---
// Money and secret operations are routed through Paybox (passkey-gated). When
// Paybox isn't connected, gated tools refuse and point the user at the connect
// flow rather than improvising another path — this is what makes Paybox a
// required part of the spend/secret surface and drives account creation.

export function isPayboxConnected(ctx: UserContext): boolean {
  return Boolean(ctx.tokens.paybox)
}

export function payboxConnectUrl(): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/integrations/paybox/auth`
}

// Standard "Paybox required" tool result. The connect URL starts Paybox OAuth,
// which signs the user up (email + passkey) if they don't have an account yet.
export function payboxRequired(action: string): ToolResult {
  return {
    success: false,
    error:
      `Paybox required: ${action} is authorized through Paybox, which secures ` +
      `payments and secrets behind the user's passkey. Tell the user to connect ` +
      `(or create) their Paybox account at ${payboxConnectUrl()} — it takes about ` +
      `30 seconds with email + passkey — then retry. Do NOT attempt another ` +
      `payment or secret path while Paybox is disconnected.`,
  }
}
