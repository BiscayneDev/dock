/**
 * Per-user capabilities: scoped, expiring, revocable objects a user creates
 * from chat (see migration 058). The first kind is 'browser_session'.
 *
 * Secrets are encrypted with the existing AES-GCM helper before they reach the
 * database, are only ever decrypted server-side, and never go in chat or logs.
 */

import { createHash, randomBytes } from 'crypto'
import { createServerClient } from '@/lib/supabase/server'
import { decryptTokenFromDb, encryptTokenForDb } from '@/lib/crypto'

export type CapabilityKind = 'browser_session' | 'workflow'
export type CapabilityMode = 'read' | 'write'

export const CONNECT_LINK_TTL_SECONDS = 15 * 60
/** Default life of a connected session. Reconnect after this. */
export const DEFAULT_CAPABILITY_TTL_DAYS = 30

const sha = (t: string): string => createHash('sha256').update(t).digest('hex')

export interface CapabilityRow {
  id: string
  user_id: string
  kind: CapabilityKind
  label: string
  scope: Record<string, unknown>
  mode: CapabilityMode
  created_at: string
  expires_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const PUBLIC_COLUMNS = 'id,user_id,kind,label,scope,mode,created_at,expires_at,last_used_at,revoked_at'

/** Mint a one-use connect link token. Only the hash is stored. */
export async function mintConnectToken(
  userId: string,
  chatGuid: string | null,
  kind: CapabilityKind,
  params: Record<string, unknown>
): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  const { error } = await createServerClient().rpc('create_capability_connect_attempt', {
    p_hash: sha(token),
    p_user: userId,
    p_chat: chatGuid,
    p_kind: kind,
    p_params: params,
    p_ttl_seconds: CONNECT_LINK_TTL_SECONDS,
  })
  if (error) throw new Error(`connect link create failed: ${error.message}`)
  return token
}

export interface ConnectAttempt {
  user_id: string
  chat_guid: string | null
  kind: CapabilityKind
  params: Record<string, unknown>
}

/** Read a live connect attempt without using it. */
export async function peekConnectAttempt(token: string): Promise<ConnectAttempt | null> {
  if (!token) return null
  const { data } = await createServerClient().rpc('peek_capability_connect_attempt', { p_hash: sha(token) })
  return Array.isArray(data) && data.length > 0 ? (data[0] as ConnectAttempt) : null
}

/** Merge extra params into a live attempt (e.g. the login sandbox id). */
export async function updateConnectAttempt(token: string, params: Record<string, unknown>): Promise<boolean> {
  const { data } = await createServerClient().rpc('update_capability_connect_attempt', { p_hash: sha(token), p_params: params })
  return data === true
}

/** Use a live connect attempt once. Null if it was already used or expired. */
export async function consumeConnectAttempt(token: string): Promise<ConnectAttempt | null> {
  if (!token) return null
  const { data, error } = await createServerClient().rpc('consume_capability_connect_attempt', { p_hash: sha(token) })
  if (error || !Array.isArray(data) || data.length === 0) return null
  return data[0] as ConnectAttempt
}

export interface SaveCapabilityInput {
  userId: string
  kind: CapabilityKind
  label: string
  scope: Record<string, unknown>
  mode?: CapabilityMode
  secret: unknown
  ttlDays?: number
}

/** Save (or replace) a capability, encrypting its secret. Returns the new row id. */
export async function saveCapability(input: SaveCapabilityInput): Promise<string> {
  const supabase = createServerClient()
  const now = new Date()
  // Reconnecting replaces: revoke any live row for the same user+kind+label first.
  await supabase
    .from('user_capabilities')
    .update({ revoked_at: now.toISOString(), secret_enc: null })
    .eq('user_id', input.userId)
    .eq('kind', input.kind)
    .eq('label', input.label)
    .is('revoked_at', null)
  const expires = new Date(now.getTime() + (input.ttlDays ?? DEFAULT_CAPABILITY_TTL_DAYS) * 86_400_000)
  const { data, error } = await supabase
    .from('user_capabilities')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      label: input.label,
      scope: input.scope,
      mode: input.mode ?? 'read',
      secret_enc: encryptTokenForDb(JSON.stringify(input.secret)),
      expires_at: expires.toISOString(),
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`capability save failed: ${error?.message ?? 'no row'}`)
  return (data as { id: string }).id
}

/** The user's live capabilities (no secrets). Expired and revoked rows are excluded. */
export async function listCapabilities(userId: string, kind?: CapabilityKind): Promise<CapabilityRow[]> {
  let q = createServerClient()
    .from('user_capabilities')
    .select(PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
  if (kind) q = q.eq('kind', kind)
  const { data } = await q.order('created_at', { ascending: false })
  return (data ?? []) as CapabilityRow[]
}

/**
 * Load one live capability and decrypt its secret. Null if missing, revoked
 * or expired. Does not touch last_used_at (call touchCapability when a run
 * actually completes). Callers must not log or return the secret.
 */
export async function loadCapabilitySecret<T>(
  userId: string,
  kind: CapabilityKind,
  label: string
): Promise<{ row: CapabilityRow; secret: T } | null> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('user_capabilities')
    .select(`${PUBLIC_COLUMNS},secret_enc`)
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('label', label)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  const row = data as (CapabilityRow & { secret_enc: string | null }) | null
  if (!row || !row.secret_enc) return null
  let secret: T
  try {
    secret = JSON.parse(decryptTokenFromDb(row.secret_enc)) as T
  } catch {
    return null
  }
  const { secret_enc: _omit, ...pub } = row
  void _omit
  return { row: pub, secret }
}

/** Revoke by label, or everything of a kind when label is omitted. Deletes the secret now. Returns rows revoked. */
export async function revokeCapabilities(userId: string, kind: CapabilityKind, label?: string): Promise<number> {
  let q = createServerClient()
    .from('user_capabilities')
    .update({ revoked_at: new Date().toISOString(), secret_enc: null })
    .eq('user_id', userId)
    .eq('kind', kind)
    .is('revoked_at', null)
  if (label) q = q.eq('label', label)
  const { data } = await q.select('id')
  return Array.isArray(data) ? data.length : 0
}

/** Stamp last_used_at once a run has actually completed. Best effort; the audit row is the record. */
export async function touchCapability(capabilityId: string): Promise<void> {
  await createServerClient().from('user_capabilities').update({ last_used_at: new Date().toISOString() }).eq('id', capabilityId)
}

/**
 * Open an audit row for a capability run. Fail-closed: if the row cannot be
 * written this throws, and the caller must not start the run. Never put
 * secrets or page content in the task text.
 */
export async function startRun(input: {
  userId: string
  capabilityId: string | null
  kind: CapabilityKind
  label: string
  mode: CapabilityMode
  task: string
}): Promise<string> {
  const { data, error } = await createServerClient()
    .from('capability_runs')
    .insert({
      user_id: input.userId,
      capability_id: input.capabilityId,
      kind: input.kind,
      label: input.label,
      mode: input.mode,
      task: input.task.slice(0, 500),
    })
    .select('id')
    .single()
  const id = (data as { id: string } | null)?.id
  if (error || !id) throw new Error(`audit row could not be written${error ? `: ${error.message}` : ''}`)
  return id
}

export async function finishRun(runId: string, outcome: string, detail: Record<string, unknown>): Promise<void> {
  const { error } = await createServerClient()
    .from('capability_runs')
    .update({ ended_at: new Date().toISOString(), outcome, detail })
    .eq('id', runId)
  if (error) throw new Error(`audit row could not be closed: ${error.message}`)
}

/**
 * Append a completed audit row for a lifecycle event (connect link minted,
 * login saved, disconnect). Best effort: the event already happened, so a
 * failed write is logged, not thrown. Runs use startRun, which is fail-closed.
 */
export async function auditEvent(input: {
  userId: string
  kind: CapabilityKind
  label: string
  event: 'connect_link' | 'connected' | 'disconnected' | 'connect_cancelled' | 'saved' | 'deleted' | 'run_proposed' | 'run_blocked'
  detail?: Record<string, unknown>
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await createServerClient().from('capability_runs').insert({
    user_id: input.userId,
    capability_id: null,
    kind: input.kind,
    label: input.label,
    mode: 'read',
    task: `event:${input.event}`,
    started_at: now,
    ended_at: now,
    outcome: 'ok',
    detail: input.detail ?? {},
  })
  if (error) console.error('capability audit event failed:', error.message)
}
