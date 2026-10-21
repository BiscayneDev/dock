/**
 * Paybox OAuth connect — the web-platform flow.
 *
 * Mirrors the SDK's `loginLoopback` but shaped for a browser: instead of a
 * localhost loopback server, the "Connect Paybox" button starts the flow and
 * Paybox redirects back to OUR callback route.
 *
 * Flow: OAuth discovery (`/.well-known/oauth-authorization-server`) → dynamic
 * client registration (redirect_uri = <origin>/api/paybox/connect/callback) →
 * PKCE authorize redirect (user approves with a passkey in the browser) →
 * callback exchanges the code for access/refresh tokens.
 *
 * The verifier + state ride in short-lived httpOnly cookies (serverless-safe);
 * tokens persist via the paybox store (KV / data/paybox.json / instance
 * memory). No secrets are ever rendered to the client.
 */

import { createHash, randomBytes } from "crypto"

export interface PayboxOauth {
  clientId: string
  accessToken: string
  refreshToken?: string
  /** Epoch millis the access token expires. */
  expiresAt?: number
  resource: string
}

interface OauthMetadata {
  registration_endpoint: string
  authorization_endpoint: string
  token_endpoint: string
}

export function payboxApiBase(): string {
  return (process.env.PAYBOX_BASE_URL ?? "https://api.paybox.sh").replace(/\/+$/, "")
}

function base64url(b: Buffer): string {
  return b.toString("base64url")
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

async function metadata(baseUrl: string): Promise<OauthMetadata> {
  const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
  if (!res.ok) throw new Error(`could not read Paybox OAuth metadata (${res.status})`)
  return (await res.json()) as OauthMetadata
}

/** Register (or re-register) a dynamic client for this platform's callback. */
async function registerClient(
  meta: OauthMetadata,
  clientName: string,
  redirectUri: string,
): Promise<string> {
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  })
  if (!res.ok) throw new Error(`Paybox client registration failed (${res.status})`)
  const { client_id: clientId } = (await res.json()) as { client_id: string }
  return clientId
}

export interface ConnectStart {
  /** URL the browser should be sent to for passkey approval. */
  authorizeUrl: string
  /** Opaque values to carry in short-lived httpOnly cookies. */
  state: string
  verifier: string
  /** Registered client_id — needed for later token refresh. */
  clientId: string
}

/** Begin a connect: register a client and build the PKCE authorize URL. */
export async function startConnect(origin: string): Promise<ConnectStart> {
  const baseUrl = payboxApiBase()
  const meta = await metadata(baseUrl)
  const redirectUri = `${origin}/api/paybox/connect/callback`
  const clientId = await registerClient(
    meta,
    process.env.PAYBOX_CLIENT_NAME ?? "Dock",
    redirectUri,
  )
  const { verifier, challenge } = pkce()
  const state = base64url(randomBytes(16))
  const resource = `${baseUrl}/mcp`
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp offline_access",
    state,
    resource,
  })
  return {
    authorizeUrl: `${meta.authorization_endpoint}?${params.toString()}`,
    state,
    verifier,
    clientId,
  }
}

/** Exchange the authorization code for tokens. */
export async function completeConnect(
  origin: string,
  code: string,
  verifier: string,
  clientId: string,
): Promise<PayboxOauth> {
  const baseUrl = payboxApiBase()
  const meta = await metadata(baseUrl)
  const resource = `${baseUrl}/mcp`
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    // Public client: no secret, but client_id is required in the body
    // (docs.paybox.sh/connect/oauth → Exchange).
    client_id: clientId,
    code,
    redirect_uri: `${origin}/api/paybox/connect/callback`,
    code_verifier: verifier,
    resource,
  })
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Paybox token exchange failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  if (!t.access_token) throw new Error("Paybox token exchange returned no access token")
  return {
    clientId,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1e3 : undefined,
    resource,
  }
}

/** Refresh an access token (rotation-aware: falls back to the current one). */
export async function refreshOauth(current: PayboxOauth): Promise<PayboxOauth> {
  if (!current.refreshToken) throw new Error("no refresh token — reconnect Paybox")
  const baseUrl = payboxApiBase()
  const meta = await metadata(baseUrl)
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: current.clientId,
    resource: current.resource ?? `${baseUrl}/mcp`,
  })
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  })
  if (!res.ok) throw new Error(`Paybox token refresh failed (${res.status})`)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  return {
    ...current,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? current.refreshToken,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1e3 : undefined,
  }
}

export const CONNECT_STATE_COOKIE = "paybox_connect_state"
export const CONNECT_VERIFIER_COOKIE = "paybox_connect_verifier"
export const CONNECT_CLIENT_COOKIE = "paybox_connect_client"
