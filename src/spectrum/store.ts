/**
 * Spectrum-side persistence: identity, history, connect tokens, resume poll.
 *
 * Self-contained (no `@/` aliases — src/spectrum runs standalone via tsx).
 * NOTE: the connect-token envelope logic mirrors src/lib/connect-token.ts;
 * keep the two in sync (HMAC-SHA256 over base64url payload, ENCRYPTION_KEY).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash, createHmac, randomBytes } from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
export const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000

let client: SupabaseClient | null = null

function db(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Spectrum persistence')
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return client
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Make sure this chat guid has an identity row. `handle` is the sender
 * identifier (phone/email-style) when Photon provides one — stored for
 * diagnostics/collision auditing; chat_guid remains the stable join key.
 * Returns the bound user_id or null (unbound until first connect).
 */
export async function ensureIdentity(chatGuid: string, handle?: string | null): Promise<string | null> {
  const supabase = db()
  const { data: existing } = await supabase
    .from('spectrum_identities')
    .select('id, user_id, handle')
    .eq('chat_guid', chatGuid)
    .maybeSingle()
  if (existing) {
    if (handle && existing.handle !== handle) {
      await supabase.from('spectrum_identities').update({ handle }).eq('chat_guid', chatGuid)
    }
    return (existing.user_id as string | null) ?? null
  }

  await supabase
    .from('spectrum_identities')
    .upsert({ chat_guid: chatGuid, handle: handle ?? null }, { onConflict: 'chat_guid' })
  return null
}

export async function isGoogleConnected(chatGuid: string): Promise<boolean> {
  const supabase = db()
  const { data: identity } = await supabase
    .from('spectrum_identities')
    .select('user_id')
    .eq('chat_guid', chatGuid)
    .maybeSingle()
  if (!identity?.user_id) return false

  const { data } = await supabase
    .from('oauth_tokens')
    .select('id')
    .eq('user_id', identity.user_id as string)
    .eq('provider', 'google')
    .maybeSingle()
  return !!data
}

// ── History ─────────────────────────────────────────────────────────────────

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function loadHistory(chatGuid: string, limit = 20): Promise<HistoryMessage[]> {
  const supabase = db()
  const { data } = await supabase
    .from('spectrum_messages')
    .select('role, content, created_at')
    .eq('chat_guid', chatGuid)
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as { role: string; content: string }[]
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .slice(-limit)
    .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
}

export async function saveMessage(chatGuid: string, role: 'user' | 'assistant', content: string): Promise<void> {
  const supabase = db()
  await supabase.from('spectrum_messages').insert({ chat_guid: chatGuid, role, content })
}

// ── Connect tokens (mirrors src/lib/connect-token.ts) ──────────────────────

function getSecret(): string {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) throw new Error('ENCRYPTION_KEY is not set — cannot sign connect tokens')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * Create a one-use connect link for this iMessage chat. The original
 * request rides in the row so the callback can resume it.
 */
export async function createConnectLink(chatGuid: string, pendingRequest: string): Promise<string> {
  const payload = { platform: 'imessage' as const, chatId: chatGuid, pendingRequest, ts: Date.now() }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const token = `${encoded}.${sign(encoded)}`

  const supabase = db()
  const { error } = await supabase.from('connect_tokens').insert({
    token_hash: hashToken(token),
    platform: 'imessage',
    chat_id: chatGuid,
    pending_request: pendingRequest,
    expires_at: new Date(Date.now() + CONNECT_TOKEN_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`Failed to persist connect token: ${error.message}`)

  return `${APP_URL}/connect?connect=${encodeURIComponent(token)}`
}

/**
 * Resume poll source of truth — chats with a completed-but-unresumed connect.
 * Querying the DB (not an in-memory set) makes resume survive process
 * restarts: a fresh Spectrum instance picks up pending resumes immediately.
 */
export async function listUnresumedResumeChats(): Promise<string[]> {
  const supabase = db()
  const { data } = await supabase
    .from('connect_tokens')
    .select('chat_id')
    .eq('platform', 'imessage')
    .not('completed_at', 'is', null)
    .is('resumed_at', null)
    .not('pending_request', 'is', null)
  return [...new Set(((data ?? []) as { chat_id: string }[]).map((r) => r.chat_id))]
}

/**
 * Resume poll: LEASE-BASED claim (lossless across restarts). Atomically
 * takes a delivery lease on the oldest completed-but-undelivered token.
 * `resumed_at` is NOT written here — it is the delivery acknowledgement,
 * set only by ackResume() after space.send() succeeds. An expired lease is
 * stealable, so a crash between claim and send is retried by the next poll.
 */
export const RESUME_LEASE_MS = 60 * 1000

export async function claimPendingResume(
  chatGuid: string
): Promise<{ id: string; pendingRequest: string } | null> {
  const supabase = db()
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
  const supabase = db()
  await supabase
    .from('connect_tokens')
    .update({ resumed_at: new Date().toISOString(), delivery_claimed_at: null })
    .eq('id', tokenRowId)
    .is('resumed_at', null)
}
