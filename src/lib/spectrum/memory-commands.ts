/**
 * /memory transparency + "forget X" intent (Workstream F1).
 *
 * A person texting Dinghy should be able to see exactly what is remembered
 * and delete any of it, in plain text:
 *
 *   "/memory" (or "what do you know about me") → short lowercase list of
 *     the profile + the most recent facts, via the same user-keyed RPCs
 *     memory.ts reads with (chat fallback for guest chats).
 *
 *   "forget X" / "forget that X" → soft-deletes matching facts right away
 *     (single facts don't need a confirmation; the delete is reversible).
 *   "forget everything" → gated: the server texts "reply YES to wipe it
 *     all", the gate row lives in dinghy_memory_wipes (migration 039) so it
 *     survives across messages, and only an explicit YES wipes. Anything
 *     else cancels the request and flows on as a normal message.
 */

import { createServerClient } from '@/lib/supabase/server'
import { forgetMemories, resolveUserId } from './memory'
import { forgetAllPlansAndFiles, forgetPlans, loadUpcomingPlans, recentFiles, renderFileLine, renderPlan } from './plans'

const RECENT_LIMIT = 10

export function isMemoryCommand(text: string): boolean {
    const t = text.trim().toLowerCase()
    return t === '/memory' || /\bwhat do you (remember|know) about me\??\b/.test(t)
}

export type ForgetIntent = { kind: 'match'; match: string } | { kind: 'all' }

/**
 * "forget X" / "forget about X" / "forget that X" → match; "forget
 * everything" / "wipe your memory" → all. Idiomatic "forget it" and bare
 * "forget that" are NOT intents (that's never-mind, not a memory request).
 */
export function parseForgetIntent(text: string): ForgetIntent | null {
    const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
    if (/^(?:please\s+)?(?:you\s+can\s+)?forget everything(?: about me)?$/.test(t)) return { kind: 'all' }
    if (/^(?:forget all of it|forget it all|wipe (?:your|the) (?:memory|memories))$/.test(t) || /^please\s+(?:forget all of it|forget it all)$/.test(t)) return { kind: 'all' }
    const m = t.match(/^(?:please\s+)?forget (?:about |that |i said |i told you )?(?:about )?(.+)$/)
    if (!m) return null
    const match = m[1].trim()
    if (!match || match === 'it' || match === 'that' || match === 'about it') return null
    return { kind: 'match', match }
}

/** Short lowercase report of everything currently remembered. */
export async function renderMemoryReport(chatGuid: string): Promise<string> {
    const supabase = createServerClient()
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const [ctxRpc, ctxArgs] = userId
        ? ['dinghy_user_memory_context', { p_user_id: userId }]
        : ['dinghy_memory_context', { p_chat_guid: chatGuid }]
    const [recentRpc, recentArgs] = userId
        ? ['recent_user_memories', { p_user_id: userId, p_limit: RECENT_LIMIT }]
        : ['recent_chat_memories', { p_chat_guid: chatGuid, p_limit: RECENT_LIMIT }]
    const [ctxRes, recentRes] = await Promise.all([
        supabase.rpc(ctxRpc as string, ctxArgs),
        supabase.rpc(recentRpc as string, recentArgs),
    ])
    if (ctxRes.error) throw new Error(`${ctxRpc} failed: ${ctxRes.error.message}`)
    const profile = ((ctxRes.data ?? {}) as { profile?: string }).profile ?? ''
    const recentRows = Array.isArray(recentRes.data) ? (recentRes.data as { content: string }[]) : []
    const facts = recentRows
        .map((r) => r.content)
        .filter((c) => typeof c === 'string' && c.trim())
    const lines: string[] = []
    if (profile.trim()) lines.push(...profile.trim().split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean))
    const profileKeys = new Set(lines.map((l) => l.toLowerCase()))
    for (const f of facts) if (!profileKeys.has(f.toLowerCase().trim()) && lines.length < 15) lines.push(f)
    const [plans, files] = userId
        ? await Promise.all([
              loadUpcomingPlans(userId).catch(() => []),
              recentFiles(userId, 5).catch(() => []),
          ])
        : [[], []]
    if (plans.length) lines.push(...plans.map((p) => `plan: ${renderPlan(p).replace(/ \[source: [a-z]+\]$/, '')}`))
    if (files.length) lines.push(...files.map((f) => `file: ${renderFileLine(f)}`))
    if (!lines.length) return "nothing saved about you yet. tell me things and i'll remember - say 'forget x' anytime and i'll drop it."
    return "here's what i remember about you:\n" + lines.map((l) => `- ${l}`).join('\n') + "\n\nsay 'forget x' to drop one, 'forget everything' to wipe it all."
}

// ── Wipe-all gate (dinghy_memory_wipes, migration 039) ───────────────────────

/** Remember that this chat asked to wipe everything. Idempotent per chat. */
export async function requestMemoryWipe(chatGuid: string): Promise<void> {
    const { error } = await createServerClient()
        .from('dinghy_memory_wipes')
        .upsert({ chat_guid: chatGuid, requested_at: new Date().toISOString() })
    if (error) throw new Error(`request_memory_wipe failed: ${error.message}`)
}

export async function hasPendingMemoryWipe(chatGuid: string): Promise<boolean> {
    const { data, error } = await createServerClient()
        .from('dinghy_memory_wipes')
        .select('chat_guid')
        .eq('chat_guid', chatGuid)
        .maybeSingle()
    if (error) throw new Error(`has_pending_memory_wipe failed: ${error.message}`)
    return Boolean(data)
}

async function clearMemoryWipe(chatGuid: string): Promise<void> {
    await createServerClient().from('dinghy_memory_wipes').delete().eq('chat_guid', chatGuid)
}

/**
 * Soft-delete every active memory for the chat (user-wide when bound).
 * Returns how many rows were superseded.
 */
export async function forgetAllMemories(chatGuid: string): Promise<number> {
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const [rpc, args] = userId
        ? ['forget_all_user_memories', { p_user_id: userId }]
        : ['forget_all_chat_memories', { p_chat_guid: chatGuid }]
    const { data, error } = await createServerClient().rpc(rpc as string, args)
    if (error) throw new Error(`${rpc} failed: ${error.message}`)
    const extra = userId ? await forgetAllPlansAndFiles(userId).catch(() => 0) : 0
    await clearMemoryWipe(chatGuid).catch(() => undefined)
    return ((data as number) ?? 0) + extra
}

const WIPE_CONFIRM = /^\s*(?:yes|y)\s*[.!]*\s*$/i

/**
 * The text the server sends for a wipe-all request (explicit-YES gate; the
 * destructive bulk clear never runs on a casual "ok").
 */
export const WIPE_PROMPT = 'that clears everything i remember about you, across all our chats. reply YES to wipe it all - anything else cancels.'

/**
 * Handle a message that arrives with a wipe-all request open. Returns the
 * reply text when the message was consumed (YES → wiped; anything else →
 * request cancelled), or null when it wasn't a wipe confirmation and the
 * message should flow on through the normal path.
 */
export async function handlePendingMemoryWipe(chatGuid: string, text: string): Promise<string | null> {
    if (!(await hasPendingMemoryWipe(chatGuid))) return null
    if (WIPE_CONFIRM.test(text)) {
        const n = await forgetAllMemories(chatGuid)
        return n > 0 ? `done - wiped everything i remembered (${n} thing${n === 1 ? '' : 's'}). fresh start.` : 'nothing was saved anyway, but the slate is clean.'
    }
    await clearMemoryWipe(chatGuid).catch(() => undefined)
    return 'ok, cancelled - i kept everything.'
}

// ── Single-fact forget ("forgot that" runs directly; it's reversible) ────────

export async function forgetMatch(chatGuid: string, match: string): Promise<number> {
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const [facts, plans] = await Promise.all([
        forgetMemories(chatGuid, match),
        userId ? forgetPlans(userId, match).catch(() => 0) : Promise.resolve(0),
    ])
    return facts + plans
}
