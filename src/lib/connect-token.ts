import { createHash, createHmac, randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'

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
  token: string
): Promise<{ oauthState: string; platform: ConnectPlatform; chatId: string } | null> {
  if (!verifyConnectEnvelope(token)) return null

  const oauthState = randomBytes(24).toString('hex')
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('connect_tokens')
    .update({ used_at: new Date().toISOString(), oauth_state: oauthState })
    .eq('token_hash', hashToken(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('platform, chat_id')
    .maybeSingle()

  if (error || !data) return null
  return {
    oauthState,
    platform: data.platform as ConnectPlatform,
    chatId: data.chat_id as string,
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
  oauthState: string
): Promise<ConnectRow | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('connect_tokens')
    .update({ claimed_at: new Date().toISOString() })
    .eq('oauth_state', oauthState)
    .not('used_at', 'is', null)
    .is('completed_at', null)
    .is('claimed_at', null)
    .select('id, platform, chat_id, pending_request')
    .maybeSingle()

  if (error || !data) return null
  return {
    id: data.id as string,
    platform: data.platform as ConnectPlatform,
    chatId: data.chat_id as string,
    pendingRequest: (data.pending_request as string | null) ?? null,
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
}

/**
 * Mark a connect attempt terminal — used after the authorization code has been
 * consumed (single-use). The same state cannot retry; the user must start a
 * fresh connect token from their chat. Sets `completed_at` to prevent
 * re-claiming and signals the attempt is done (failed).
 */
export async function markConnectTerminal(tokenRowId: string): Promise<void> {
  const supabase = createServerClient()
  await supabase
    .from('connect_tokens')
    .update({ terminal_at: new Date().toISOString() })
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
 * imessage resume — called by the Spectrum process's poll. Atomically claims
 * the oldest completed-but-unresumed token for this chat guid.
 */
export async function claimPendingResume(
  chatGuid: string
): Promise<{ pendingRequest: string } | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('connect_tokens')
    .update({ resumed_at: new Date().toISOString() })
    .eq('platform', 'imessage')
    .eq('chat_id', chatGuid)
    .not('completed_at', 'is', null)
    .is('resumed_at', null)
    .not('pending_request', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .select('pending_request')
    .maybeSingle()

  if (error || !data || !data.pending_request) return null
  return { pendingRequest: data.pending_request as string }
}

/**
 * Bind an iMessage chat guid to a Dock user (creating the user on first
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
  // managed iMessage line from binding a Google account to a Dock user.
  // Halsey adds guids to the allowlist via the Supabase dashboard.
  //
  // When the allowlist is empty (not yet populated), fall open — but log
  // a warning so it's visible. Halsey must populate it before the 10-seat
  // beta opens.
  const { data: allowed } = await supabase
    .from('beta_allowlist')
    .select('chat_guid')
    .eq('chat_guid', chatGuid)
    .maybeSingle()

  const { count } = await supabase
    .from('beta_allowlist')
    .select('*', { count: 'exact', head: true })

  if (count !== null && count > 0 && !allowed) {
    console.error(`bindSpectrumIdentity: ${chatGuid} not on beta allowlist (rejected)`)
    return null
  }

  if (count === 0) {
    console.warn('bindSpectrumIdentity: beta_allowlist is empty — binding open (populate before beta)')
  }

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
