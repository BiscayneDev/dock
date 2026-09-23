import { createHash, createHmac, randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { decryptTokenFromDb, encryptTokenForDb } from '@/lib/crypto'

/**
 * Short-lived, signed, ONE-USE connect tokens.
 *
 * Carried as `?connect=<token>` on /api/integrations/google/auth so a
 * Telegram/iMessage user (who has no web session) can start the OAuth flow
 * from their chat thread. The raw token is HMAC-signed; the DB stores only
 * sha256(token) so a DB leak cannot mint links. Single use is enforced by
 * the partial unique index `connect_tokens_single_use` — consuming is a
 * conditional UPDATE, so two concurrent starts cannot both win.
 *
 * Flow:
 *   1. beginConnectByToken(token)  — verify + atomically consume + mint oauth_state
 *   2. Google consent round-trip with state=oauth_state (CSRF binding)
 *   3. completeConnectByState(state) — atomically claim the callback side
 *   4. resume: telegram dispatched from the callback; imessage polls claimPendingResume
 */

export const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

export type ConnectPlatform = 'telegram' | 'imessage'

/** Which account a connect token connects. Tokens are provider-bound: a
 *  google link can never start a paybox flow (enforced in begin_connect). */
export type ConnectProvider = 'google' | 'paybox'

export interface ConnectTokenPayload {
  platform: ConnectPlatform
  /** telegram chat id (numeric string) or iMessage chat guid */
  chatId: string
  pendingRequest?: string
  ts: number
}

export interface ConnectRow {
  id: string
  platform: ConnectPlatform
  chatId: string
  pendingRequest: string | null
  /** PKCE verifier stored server-side at begin (paybox iMessage flow). */
  pkceVerifier?: string | null
  /** OAuth client id used at begin (paybox dynamic registration). */
  oauthClientId?: string | null
}

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error('ENCRYPTION_KEY is not set — cannot sign connect tokens')
  }
  return secret
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

/** Verify the HMAC envelope: `<payload-b64>.<sig>` + TTL + shape. */
export function verifyConnectEnvelope(token: string): ConnectTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, signature] = parts
  const expected = sign(encoded)
  if (signature.length !== expected.length) return null
  if (!Buffer.from(signature).equals(Buffer.from(expected))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConnectTokenPayload
    if (typeof payload.ts !== 'number') return null
    if (Date.now() - payload.ts > CONNECT_TOKEN_TTL_MS) return null
    if (payload.platform !== 'telegram' && payload.platform !== 'imessage') return null
    if (!payload.chatId) return null
    return payload
  } catch {
    return null
  }
}

function envelope(payload: ConnectTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded)}`
}

/**
 * Create a connect token: signs the payload AND persists its hash so the
 * flow can enforce single use + carry the pending request.
 * Returns the raw token (only ever rendered into the chat link).
 */
export async function createConnectToken(
  input: Omit<ConnectTokenPayload, 'ts'>
): Promise<string> {
  const payload: ConnectTokenPayload = { ...input, ts: Date.now() }
  const token = envelope(payload)

  const supabase = createServerClient()
  const { error } = await supabase.from('connect_tokens').insert({
    token_hash: hashToken(token),
    platform: payload.platform,
    chat_id: payload.chatId,
    pending_request: payload.pendingRequest ?? null,
    expires_at: new Date(Date.now() + CONNECT_TOKEN_TTL_MS).toISOString(),
  })

  if (error) {
    throw new Error(`Failed to persist connect token: ${error.message}`)
  }

  return token
}

/**
 * Step 1 — atomically consume the token and mint the OAuth state bound to
 * the row. Returns the state to put on the Google auth URL, or null when
 * the token is invalid, expired, or already used.
 */
export async function beginConnectByToken(
  token: string,
  provider: ConnectProvider = 'google',
  pkce?: { verifier: string; clientId: string }
): Promise<{ oauthState: string; platform: ConnectPlatform; chatId: string } | null> {
  if (!verifyConnectEnvelope(token)) return null

  const oauthState = randomBytes(24).toString('hex')
  const supabase = createServerClient()
  // RPC (migration 019): provider-bound consume; PKCE verifier encrypted at rest.
  const { data, error } = await supabase.rpc('begin_connect', {
    p_token_hash: hashToken(token),
    p_provider: provider,
    p_oauth_state: oauthState,
    p_pkce_verifier: pkce ? encryptTokenForDb(pkce.verifier) : null,
    p_client_id: pkce?.clientId ?? null,
  })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    if (error) console.error('begin_connect rpc failed:', error.message)
    return null
  }
  return {
    oauthState,
    platform: row.platform as ConnectPlatform,
    chatId: row.chat_id as string,
  }
}

/**
 * Step 3 — atomically CLAIM the consumed-but-incomplete row by the OAuth
 * state Google echoed back. The claim (claimed_at) is retryable: if code
 * exchange or live verification fails, releaseConnectClaim() clears it so
 * the same consent round-trip can retry within the TTL. completed_at is set
 * ONLY after verification succeeds — a failure never burns the token.
 */
export async function claimConnectByState(
  oauthState: string,
  provider: ConnectProvider = 'google'
): Promise<ConnectRow | null> {
  const supabase = createServerClient()
  // RPC (migration 019): provider-bound claim; returns + clears the PKCE verifier.
  const { data, error } = await supabase.rpc('claim_connect_by_state', {
    p_oauth_state: oauthState,
    p_provider: provider,
  })
  const row = Array.isArray(data) ? data[0] : data
  if (error || !row) {
    if (error) console.error('claim_connect_by_state rpc failed:', error.message)
    return null
  }
  let pkceVerifier: string | null = null
  if (row.pkce_verifier) {
    try {
      pkceVerifier = decryptTokenFromDb(row.pkce_verifier as string)
    } catch {
      pkceVerifier = null
    }
  }
  return {
    id: row.id as string,
    platform: row.platform as ConnectPlatform,
    chatId: row.chat_id as string,
    pendingRequest: (row.pending_request as string | null) ?? null,
    pkceVerifier,
    oauthClientId: (row.oauth_client_id as string | null) ?? null,
  }
}

/** Release a pre-exchange claim so the state can retry (before code is consumed). */
export async function releaseConnectClaim(tokenRowId: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('connect_tokens')
    .update({ claimed_at: null })
    .eq('id', tokenRowId)
    .is('completed_at', null)
    .is('terminal_at', null)
}

/**
 * Mark a connect attempt terminal — used after the authorization code has
 * been consumed (single-use codes can't retry). One atomic write sets BOTH
 * terminal_at and completed_at: the row leaves the claimable state in the
 * same statement that marks it terminal, so no query-invariant gap exists.
 * The same state cannot retry; the user starts a fresh connect token.
 */
export async function markConnectTerminal(
  tokenRowId: string,
  opts?: { failed?: boolean }
): Promise<void> {
  const now = new Date().toISOString()
  const supabase = createServerClient()
  await supabase
    .from('connect_tokens')
    .update(
      opts?.failed
        ? { terminal_at: now, completed_at: now, claimed_at: null }
        : { terminal_at: now }
    )
    .eq('id', tokenRowId)
    .is('terminal_at', null)
}

/** Mark the flow fully complete — ONLY after live verification passes. */
export async function completeConnect(tokenRowId: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('connect_tokens')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', tokenRowId)
    .is('completed_at', null)
}

/**
 * imessage resume — LEASE-BASED claim (lossless across restarts).
 * Atomically takes a delivery lease on the oldest completed-but-undelivered
 * token for this chat. `resumed_at` is NOT set here — it is the delivery
 * acknowledgement, written only after space.send() succeeds (ackResume()).
 * A lease older than `leaseMs` is stealable, so a crash between claim and
 * send is retried by the next poll (same or restarted process).
 */
export const RESUME_LEASE_MS = 60 * 1000

export async function claimPendingResume(
  chatGuid: string
): Promise<{ id: string; pendingRequest: string } | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('connect_tokens')
    .update({ delivery_claimed_at: new Date().toISOString() })
    .eq('platform', 'imessage')
    .eq('chat_id', chatGuid)
    .not('completed_at', 'is', null)
    .is('resumed_at', null)
    .is('terminal_at', null)
    .not('pending_request', 'is', null)
    .or(`delivery_claimed_at.is.null,delivery_claimed_at.lt.${new Date(Date.now() - RESUME_LEASE_MS).toISOString()}`)
    .order('completed_at', { ascending: false })
    .limit(1)
    .select('id, pending_request')
    .maybeSingle()

  if (error || !data || !data.pending_request) return null
  return { id: data.id as string, pendingRequest: data.pending_request as string }
}

/** Delivery acknowledgement — the ONLY writer of resumed_at. */
export async function ackResume(tokenRowId: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('connect_tokens')
    .update({ resumed_at: new Date().toISOString(), delivery_claimed_at: null })
    .eq('id', tokenRowId)
    .is('resumed_at', null)
}

/**
 * Bind an iMessage chat guid to a Dinghy user (creating the user on first
 * connect). Telegram users are looked up by telegram_id and need no binding.
 */
export async function bindSpectrumIdentity(chatGuid: string, handle?: string | null): Promise<string | null> {
  const supabase = createServerClient()

  // Existing binding?
  const { data: existing } = await supabase
    .from('spectrum_identities')
    .select('user_id')
    .eq('chat_guid', chatGuid)
    .maybeSingle()
  if (existing?.user_id) {
    // Keep the handle fresh when Photon provides one.
    if (handle) {
      await supabase.from('spectrum_identities').update({ handle }).eq('chat_guid', chatGuid)
    }
    return existing.user_id as string
  }

  // Ownership gate: in private beta, only chat guids on the beta allowlist
  // may create a new binding. This prevents a random number texting the
  // managed iMessage line from binding a Google account to a Dinghy user.
  // The allowlist is empty by default — binding is CLOSED until Halsey
  // provisions guids operationally from the trusted live Spectrum record.
  // No open fallback, no placeholder seed.
  const { data: allowed, error: allowErr } = await supabase
    .from('beta_allowlist')
    .select('chat_guid')
    .eq('chat_guid', chatGuid)
    .maybeSingle()

  if (allowErr || !allowed) {
    console.error(`bindSpectrumIdentity: ${chatGuid} not on beta allowlist — rejected (fail closed)`)
    return null
  }

  // Allowlist matched — proceed to create the binding.

  // Create the backing user (telegram_id nullable since migration 011).
  const { data: user, error: userErr } = await supabase
    .from('users')
    .insert({ telegram_id: null, name: 'iMessage user' })
    .select('id')
    .single()
  if (userErr || !user) return null

  await supabase.from('spectrum_identities').upsert(
    { chat_guid: chatGuid, handle: handle ?? null, user_id: user.id, bound_at: new Date().toISOString() },
    { onConflict: 'chat_guid' }
  )
  return user.id as string
}
