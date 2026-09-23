/**
 * Spectrum-side persistence: identity, history, connect tokens, resume poll.
 *
 * Self-contained (no `@/` aliases — src/spectrum runs standalone via tsx).
 * NOTE: the connect-token envelope logic mirrors src/lib/connect-token.ts;
 * keep the two in sync (HMAC-SHA256 over base64url payload, ENCRYPTION_KEY).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { retryFetch } from '../lib/supabase/retry-fetch'
import type { DinghyFact } from '../lib/spectrum/dinghy'
export type { DinghyFact } from '../lib/spectrum/dinghy'
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
      global: { fetch: retryFetch },
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

export async function isProviderConnected(chatGuid: string, provider: ConnectProvider): Promise<boolean> {
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
    .eq('provider', provider)
    .maybeSingle()
  return !!data
}

export async function isGoogleConnected(chatGuid: string): Promise<boolean> {
  return isProviderConnected(chatGuid, 'google')
}

export async function isPayboxConnected(chatGuid: string): Promise<boolean> {
  return isProviderConnected(chatGuid, 'paybox')
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
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(limit)
  const rows = ((data ?? []) as { role: string; content: string }[]).reverse()
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
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
export type ConnectProvider = 'google' | 'paybox'

export async function createConnectLink(
  chatGuid: string,
  pendingRequest: string,
  provider: ConnectProvider = 'google'
): Promise<string> {
  const payload = { platform: 'imessage' as const, chatId: chatGuid, pendingRequest, ts: Date.now() }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const token = `${encoded}.${sign(encoded)}`

  const supabase = db()
  // RPC (migration 019): the provider column is new; PostgREST's schema cache
  // is not trusted with new columns (see 017).
  const { error } = await supabase.rpc('create_connect_token', {
    p_token_hash: hashToken(token),
    p_platform: 'imessage',
    p_chat_id: chatGuid,
    p_pending_request: pendingRequest,
    p_expires_at: new Date(Date.now() + CONNECT_TOKEN_TTL_MS).toISOString(),
    p_provider: provider,
  })
  if (error) throw new Error(`Failed to persist connect token: ${error.message}`)

  const page = provider === 'paybox' ? '/connect/paybox' : '/connect'
  return `${APP_URL}${page}?connect=${encodeURIComponent(token)}`
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
): Promise<{ id: string; pendingRequest: string; provider: ConnectProvider } | null> {
  const supabase = db()
  // RPC (migration 017, provider added in 019): a PostgREST schema-cache lag on migration 015's
  // columns made the table-UPDATE shape fail with 42703 for hours after
  // reload notifications. RPC bodies are parsed by Postgres at call time.
  const { data, error } = await supabase.rpc('claim_pending_resume', {
    p_chat_id: chatGuid,
    p_lease_ms: RESUME_LEASE_MS,
  })

  const row = Array.isArray(data) ? data[0] : data
  if (error || !row || !row.pending_request) {
    if (error) console.error('resume claim rpc failed:', error.message)
    return null
  }
  return {
    id: row.id as string,
    pendingRequest: row.pending_request as string,
    provider: ((row.provider as string | undefined) ?? 'google') as ConnectProvider,
  }
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

// ── Durable facts (dinghy_facts, migration 016) ─────────────────────────────

let factsCache: { facts: DinghyFact[]; at: number } | null = null
const FACTS_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Global key-value facts injected into the system prompt. Cached per lambda
 * instance (facts change rarely; the prompt load must not add a network
 * round trip to every message).
 */
export async function loadFacts(): Promise<DinghyFact[]> {
  if (factsCache && Date.now() - factsCache.at < FACTS_CACHE_TTL_MS) return factsCache.facts
  const supabase = db()
  const { data, error } = await supabase.from('dinghy_facts').select('key, value').order('key')
  if (error) throw new Error(`dinghy_facts load failed: ${error.message}`)
  const facts = (data ?? []) as DinghyFact[]
  factsCache = { facts, at: Date.now() }
  return facts
}
