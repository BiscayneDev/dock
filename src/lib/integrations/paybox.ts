import { createHash, randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { encryptTokenForDb } from '@/lib/crypto'
import { logger } from '@/lib/logger'
import type { DecryptedTokens, ToolResult, UserContext } from '@/lib/llm/types'

// Paybox — a passkey-gated credential vault for AI agents.
// Docs: https://docs.paybox.sh/
//
// The developer surface is OAuth 2.1 (authorize) -> MCP (act). Paybox is NOT a
// writable secret store; credentials are vaulted by the user in the Paybox app.
// Dock connects as a public OAuth client and calls the MCP tools on behalf of
// the user. Every operation is scoped to a user-approved grant and may pause for
// a passkey step-up (surfaced as `pending_approval` + an `approval_url`).

const DEFAULT_API_URL = 'https://api.paybox.sh'

export function getPayboxApiUrl(): string {
  return (process.env.PAYBOX_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '')
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

// --- MCP client (streamable HTTP, JSON-RPC 2.0) ---

const MCP_PROTOCOL_VERSION = '2025-06-18'

interface McpToolCallResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

async function mcpRpc(
  accessToken: string,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string
): Promise<{ result: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${accessToken}`,
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  }
  if (sessionId) headers['Mcp-Session-Id'] = sessionId

  const res = await fetch(getMcpResource(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })

  const returnedSessionId = res.headers.get('mcp-session-id')

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Paybox MCP ${method} failed: ${res.status} ${text}`)
  }

  const contentType = res.headers.get('content-type') ?? ''
  const parsed = contentType.includes('text/event-stream')
    ? parseSse(await res.text())
    : ((await res.json()) as { result?: unknown; error?: { message: string } })

  if (parsed.error) throw new Error(`Paybox MCP error: ${parsed.error.message}`)
  return { result: parsed.result, sessionId: returnedSessionId ?? sessionId ?? null }
}

function parseSse(text: string): { result?: unknown; error?: { message: string } } {
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (!data) continue
    try {
      const json = JSON.parse(data) as { result?: unknown; error?: { message: string } }
      if (json.result || json.error) return json
    } catch {
      // keep scanning
    }
  }
  throw new Error('No valid JSON-RPC payload in SSE stream')
}

// One MCP tool call with the full streamable-HTTP handshake: initialize ->
// notifications/initialized -> tools/call, threading the session id.
async function mcpToolCall(
  accessToken: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const init = await mcpRpc(accessToken, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'dock', version: '1.0.0' },
  })
  const sessionId = init.sessionId ?? undefined

  // Best-effort initialized notification (no response body expected).
  await fetch(getMcpResource(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {
    // non-critical
  })

  const { result } = await mcpRpc(
    accessToken,
    'tools/call',
    { name, arguments: args },
    sessionId
  )

  const call = result as McpToolCallResult
  const text = (call.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')

  if (call.isError) {
    throw new Error(text || `Paybox tool ${name} returned an error`)
  }

  // Paybox tool outputs are JSON (a result envelope or a list). Parse when we
  // can; otherwise hand back the raw text.
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// The Paybox result envelope (see /concepts/requests).
export type PayboxStatus =
  | 'success'
  | 'pending_approval'
  | 'pending_signature'
  | 'denied'
  | 'error'

export interface PayboxEnvelope {
  status?: PayboxStatus
  request_id?: string
  approval_url?: string
  output?: unknown
  reason?: string
  message?: string
  [key: string]: unknown
}

// A thin client bound to a user; refreshes the token before each call.
export class PayboxClient {
  constructor(
    private tokens: DecryptedTokens,
    private userId: string
  ) {}

  private async token(): Promise<string> {
    return getPayboxAccessToken(this.tokens, this.userId)
  }

  async listCredentials(): Promise<unknown> {
    return mcpToolCall(await this.token(), 'list_credentials', {})
  }

  async requestPayment(args: {
    credential_id: string
    merchant: string
    merchant_url: string
    amount_cents: number
    currency: string
  }): Promise<PayboxEnvelope> {
    return mcpToolCall(await this.token(), 'request_payment', args) as Promise<PayboxEnvelope>
  }

  async requestSecret(args: {
    credential_id: string
    raw?: boolean
    purpose?: string
  }): Promise<PayboxEnvelope> {
    return mcpToolCall(await this.token(), 'request_secret', args) as Promise<PayboxEnvelope>
  }

  async getRequest(requestId: string): Promise<PayboxEnvelope> {
    return mcpToolCall(await this.token(), 'get_request', {
      request_id: requestId,
    }) as Promise<PayboxEnvelope>
  }
}

export function getPayboxClient(tokens: DecryptedTokens, userId: string): PayboxClient {
  return new PayboxClient(tokens, userId)
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
