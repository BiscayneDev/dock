/**
 * Dinghy memory (migrations 024/027/035). Three layers:
 *
 *   profile    one short document about the person, rewritten over time,
 *              always in the prompt
 *   summaries  episodic summaries of conversation that has scrolled out of
 *              the 20-message history window; latest 2 in the prompt,
 *              plus older ones that match the current message
 *   facts      atomic memories in the shared `memories` table, retrieved by
 *              relevance to the current message (pgvector similarity,
 *              topped up newest-first; newest-first only without a key)
 *
 * Scope: when the chat is bound to a Dock user via `spectrum_identities`
 * (migration 011), memory is USER-level — facts learned in one chat are
 * retrievable in every other chat of the same person (migration 035 RPCs).
 * Unbound/guest chats stay chat_guid-isolated on the 024 RPCs. Summaries
 * stay per-chat (they describe one conversation) but are recalled across
 * the user's chats when bound. Each fact row is tagged with source_channel.
 *
 * Reads happen before the reply (one RPC + one embed). Writes happen after
 * the reply is sent, at most once every UPDATE_EVERY messages, so memory
 * never adds latency to a reply. Every failure degrades to "no memory".
 */

import { createServerClient } from '@/lib/supabase/server'
import { embedText, currentEmbeddingModel } from '@/lib/memory/embeddings'
import { GATEWAY_URL, SHIPYARD_API_KEY, SHIPYARD_MODEL } from './config'
import { cleanPlans, isAbsence, loadUpcomingPlans, recentFiles, renderFileLine, renderPlan, savePlans } from './plans'

/**
 * Extraction cadence (F3 audit + fix): UPDATE_EVERY used to be 10, so a
 * stated personal fact could sit un-extracted for ten messages. Lowered to
 * 4 — at most a few messages of delay — while keeping the atomic
 * claim/lease semantics: the claim still fires at most once per window
 * (one cheap extraction call), and the extraction window still spans the
 * full gap since the previous claim (total - previously_seen), so nothing
 * is missed by the tighter cadence.
 */
export const UPDATE_EVERY = 4
export const HISTORY_WINDOW = 20
const SUMMARIZE_MIN = 20
const SUMMARIZE_MAX = 60
const FACT_LIMIT = 5
const FACT_MIN_SIMILARITY = 0.3
const DUPLICATE_SIMILARITY = 0.92
const PROFILE_CAP = 1200
const SUMMARY_CAP = 600
const VALID_TYPES = new Set(['fact', 'person', 'preference', 'org', 'event'])

export interface MemoryContext {
    profile: string
    summaries: string[]
    facts: string[]
    /** Upcoming trips/events (migration 046), rendered one per line. */
    plans?: string[]
    /** Files Dinghy made for this person, newest first, rendered one per line. */
    files?: string[]
}

export const EMPTY_MEMORY: MemoryContext = { profile: '', summaries: [], facts: [], plans: [], files: [] }

// ── Secret guard: nothing that looks like a credential is ever stored. ──────

const SECRET_PATTERNS: RegExp[] = [
    /\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA|AIza|sbp|eyJ)[A-Za-z0-9_\-.]{12,}/,
    /\b[A-Fa-f0-9]{32,}\b/,
    /\b[1-9A-HJ-NP-Za-km-z]{43,88}\b/, // base58 keys / signatures
    /\b(?:\d[ -]?){13,19}\b/, // card-like numbers
    /\b(password|passcode|passwd|pin code|seed phrase|recovery phrase|mnemonic|private key|secret key|api key|cvv|cvc|ssn|social security)\b/i,
    /\b\d{3}-\d{2}-\d{4}\b/,
]

export function looksSecret(text: string): boolean {
    return SECRET_PATTERNS.some((re) => re.test(text))
}

// ── Prompt block ──────────────────────────────────────────────────────────────

/** The memory section appended to the system prompt; empty string when nothing is known. */
export function renderMemoryBlock(m: MemoryContext): string {
    const parts: string[] = []
    if (m.profile.trim()) parts.push(`What you know about this person:\n${m.profile.trim().slice(0, PROFILE_CAP)}`)
    if (m.summaries.length) {
        parts.push(`Earlier conversation (summaries, oldest first):\n${m.summaries.map((s) => `- ${s.slice(0, SUMMARY_CAP)}`).join('\n')}`)
    }
    if (m.plans?.length) parts.push(`Upcoming plans (keep these in mind; update them when they change):\n${m.plans.map((p) => `- ${p}`).join('\n')}`)
    if (m.files?.length) parts.push(`Files you made for them (newest first; recall_file opens one):\n${m.files.map((f) => `- ${f}`).join('\n')}`)
    if (m.facts.length) parts.push(`Possibly relevant memories:\n${m.facts.map((f) => `- ${f}`).join('\n')}`)
    if (!parts.length) return ''
    return (
        '\n\n' +
        parts.join('\n\n') +
        '\n\nUse this only when it helps; do not recite it. If it conflicts with what they say now, trust what they say now.'
    )
}

// ── Scope: chat_guid → user_id via the spectrum_identities binding ───────────

/** Null for guest/unbound chats — their memory stays chat_guid-isolated. */
export async function resolveUserId(chatGuid: string): Promise<string | null> {
    const { data, error } = await createServerClient()
        .from('spectrum_identities')
        .select('user_id')
        .eq('chat_guid', chatGuid)
        .not('user_id', 'is', null)
        .limit(1)
    if (error) return null
    const row = (data as { user_id: string }[] | null)?.[0]
    return row?.user_id ?? null
}

// ── Read path ─────────────────────────────────────────────────────────────────

export async function loadMemoryContext(chatGuid: string, query: string): Promise<MemoryContext> {
    const supabase = createServerClient()
    const userId = await resolveUserId(chatGuid).catch(() => null)
    // One embedding per message, shared by fact and summary recall. Bounded
    // so a slow embeddings API never delays the reply.
    const embedding = query.trim().length >= 3 ? await withTimeout(embedText(query), EMBED_READ_TIMEOUT_MS).catch(() => null) : null
    const ctxRpc = userId ? 'dinghy_user_memory_context' : 'dinghy_memory_context'
    const ctxArgs = userId ? { p_user_id: userId } : { p_chat_guid: chatGuid }
    const [ctxRes, facts, older, plans, files] = await Promise.all([
        supabase.rpc(ctxRpc, ctxArgs),
        relevantFacts(chatGuid, userId, embedding).catch(() => [] as string[]),
        relevantSummaries(chatGuid, userId, embedding).catch(() => [] as string[]),
        userId ? loadUpcomingPlans(userId).then((r) => r.map(renderPlan)).catch(() => [] as string[]) : Promise.resolve([] as string[]),
        userId ? recentFiles(userId, 5).then((r) => r.map((f) => renderFileLine(f))).catch(() => [] as string[]) : Promise.resolve([] as string[]),
    ])
    if (ctxRes.error) throw new Error(`${ctxRpc} failed: ${ctxRes.error.message}`)
    const d = (ctxRes.data ?? {}) as { profile?: string; summaries?: string[] }
    const latest = Array.isArray(d.summaries) ? d.summaries : []
    return { profile: d.profile ?? '', summaries: [...older, ...latest], facts, plans, files }
}

export const EMBED_READ_TIMEOUT_MS = 1500
const SUMMARY_MIN_SIMILARITY = 0.35

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

/**
 * Most relevant facts first (cosine similarity above a floor), topped up
 * with the newest facts so a vague message still gets some context.
 */
export function mergeFacts(matched: { content: string; similarity: number }[], recent: string[], limit = FACT_LIMIT): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (c: string) => {
        const k = c.toLowerCase().trim()
        if (!k || seen.has(k) || out.length >= limit) return
        seen.add(k)
        out.push(c)
    }
    matched.filter((r) => r.similarity >= FACT_MIN_SIMILARITY).forEach((r) => add(r.content))
    recent.forEach(add)
    return out
}

async function relevantFacts(chatGuid: string, userId: string | null, embedding: number[] | null): Promise<string[]> {
    const supabase = createServerClient()
    const matchRpc = userId ? 'match_user_memories' : 'match_chat_memories'
    const matchArgs = userId
        ? { p_user_id: userId, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: FACT_LIMIT }
        : { p_chat_guid: chatGuid, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: FACT_LIMIT }
    const [matchRes, recentRes] = await Promise.all([
        embedding
            ? supabase.rpc(matchRpc, matchArgs)
            : Promise.resolve({ data: [], error: null }),
        userId
            ? supabase.rpc('recent_user_memories', { p_user_id: userId, p_limit: FACT_LIMIT })
            : supabase.rpc('recent_chat_memories', { p_chat_guid: chatGuid, p_limit: FACT_LIMIT }),
    ])
    const matched = !matchRes.error && Array.isArray(matchRes.data) ? (matchRes.data as { content: string; similarity: number }[]) : []
    const recent = ((recentRes.data ?? []) as { content: string }[]).map((r) => r.content)
    return mergeFacts(matched, recent)
}

/** Older summaries that match this message (the latest 2 are always included separately). */
async function relevantSummaries(chatGuid: string, userId: string | null, embedding: number[] | null): Promise<string[]> {
    if (!embedding) return []
    const rpc = userId ? 'match_user_summaries' : 'match_chat_summaries'
    const args = userId
        ? { p_user_id: userId, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: 2 }
        : { p_chat_guid: chatGuid, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: 2 }
    const { data, error } = await createServerClient().rpc(rpc, args)
    if (error || !Array.isArray(data)) return []
    return (data as { summary: string; last_at: string; similarity: number }[])
        .filter((r) => r.similarity >= SUMMARY_MIN_SIMILARITY)
        .sort((a, b) => Date.parse(a.last_at) - Date.parse(b.last_at))
        .map((r) => r.summary)
}

// ── Write path (after the reply) ──────────────────────────────────────────────

interface Row {
    role: string
    content: string
    created_at: string
}

async function gatewayJson(system: string, user: string, maxTokens: number): Promise<Record<string, unknown> | null> {
    if (!SHIPYARD_API_KEY) return null
    const res = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SHIPYARD_API_KEY}` },
        body: JSON.stringify({
            model: SHIPYARD_MODEL,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            max_tokens: maxTokens,
            stream: false,
        }),
    })
    if (!res.ok) throw new Error(`gateway ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] }
    return parseJsonObject(data.choices?.[0]?.message?.content ?? '')
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
        const v = JSON.parse(m[0])
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    } catch {
        return null
    }
}

const transcript = (rows: Row[], cap: number) =>
    rows
        .map((r) => `${r.role === 'assistant' ? 'dinghy' : 'user'}: ${r.content}`)
        .join('\n')
        .slice(-cap)

/** Clean model-proposed facts: valid type, non-empty, no secrets, deduped. */
export function cleanFacts(raw: unknown, existing: string[]): { content: string; type: string }[] {
    if (!Array.isArray(raw)) return []
    const seen = new Set(existing.map((c) => c.toLowerCase().trim()))
    const out: { content: string; type: string }[] = []
    for (const f of raw) {
        const content = typeof f?.content === 'string' ? f.content.trim() : ''
        const type = typeof f?.type === 'string' && VALID_TYPES.has(f.type) ? f.type : 'fact'
        if (content.length < 4 || content.length > 300 || looksSecret(content) || isAbsence(content)) continue
        const key = content.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ content, type })
        if (out.length >= 5) break
    }
    return out
}

/** Keep profile lines that don't look like secrets; cap length. */
export function cleanProfile(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const lines = raw
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() && !looksSecret(l) && !isAbsence(l))
    const text = lines.join('\n').slice(0, PROFILE_CAP).trim()
    return text || null
}

const PROFILE_SYSTEM = `You maintain memory for Dinghy, a personal assistant that texts with one person.
Given the current profile, known facts, known plans, and recent messages, return ONLY JSON:
{"profile": "...", "facts": [{"content": "...", "type": "fact|person|preference|org|event"}], "plans": [{"title": "...", "kind": "trip|event|other", "starts_on": "YYYY-MM-DD or null", "ends_on": "YYYY-MM-DD or null", "places": ["..."], "people": ["..."], "details": "...", "source": "user|file|email|calendar"}]}
profile: the full updated profile of this person in short "- " lines (name, work, people in their life, preferences). Rewrite it: keep what is still true, fix what changed, drop what is stale. Max ~15 lines. Trips and events go in plans, not the profile.
facts: up to 5 NEW concrete, reusable facts from the recent messages not already known. Include dates for time-bound facts.
plans: trips and events mentioned in the recent messages, new or changed (repeat the known title to update one). Keep dates, places, flights, hotels, reservations, and who is going word for word in details. Use absolute dates; today is {TODAY}.
Only save what the person said, or what a source Dinghy read (their email, calendar, a file) actually showed; set source to match. Never save an absence or a failed lookup as memory: no "has not booked", "not on the calendar", "no emails found", "nothing scheduled". If a search came up empty, save nothing about it.
Never include passwords, codes, keys, card or account numbers, or anything secret. Only facts about the person, never about Dinghy itself.`

const SUMMARY_SYSTEM = `Summarize this stretch of a text conversation between a person and their assistant Dinghy in 2-4 plain sentences: what they talked about, decisions, and anything left open. Include dates when mentioned. Never include secrets, codes, or account numbers. Return ONLY JSON: {"summary": "..."}`

export async function storeFacts(chatGuid: string, userId: string | null, sourceChannel: string, facts: { content: string; type: string }[]): Promise<number> {
    const supabase = createServerClient()
    let n = 0
    for (const f of facts) {
        const embedding = await embedText(f.content)
        if (embedding) {
            const [matchRpc, matchArgs] = userId
                ? ['match_user_memories', { p_user_id: userId, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: 1 }]
                : ['match_chat_memories', { p_chat_guid: chatGuid, p_embedding: JSON.stringify(embedding), p_model: currentEmbeddingModel(), p_limit: 1 }]
            const { data } = await supabase.rpc(matchRpc as string, matchArgs)
            const top = (data as { similarity: number }[] | null)?.[0]
            if (top && top.similarity > DUPLICATE_SIMILARITY) continue
        }
        const [addRpc, addArgs] = userId
            ? ['add_user_memory', { p_user_id: userId, p_chat_guid: chatGuid, p_channel: sourceChannel, p_type: f.type, p_content: f.content, p_embedding: embedding ? JSON.stringify(embedding) : null, p_model: embedding ? currentEmbeddingModel() : null }]
            : ['add_chat_memory', { p_chat_guid: chatGuid, p_channel: sourceChannel, p_type: f.type, p_content: f.content, p_embedding: embedding ? JSON.stringify(embedding) : null, p_model: embedding ? currentEmbeddingModel() : null }]
        const { error } = await supabase.rpc(addRpc as string, addArgs)
        if (!error) n++
    }
    return n
}

/**
 * Called after each reply. Cheap no-op unless UPDATE_EVERY new messages have
 * arrived (atomic claim, per-chat cadence — unchanged). When the chat is
 * bound to a user, the claim is guarded to bound chats and the profile +
 * facts are written at user level; summaries stay per-chat.
 */
export async function updateMemory(chatGuid: string, sourceChannel = 'imessage'): Promise<void> {
    const supabase = createServerClient()
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const claimRpc = userId ? 'claim_user_memory_update' : 'claim_memory_update'
    const claimArgs = userId ? { p_user_id: userId, p_chat_guid: chatGuid, p_every: UPDATE_EVERY } : { p_chat_guid: chatGuid, p_every: UPDATE_EVERY }
    const { data: claim, error } = await supabase.rpc(claimRpc, claimArgs)
    if (error) throw new Error(`${claimRpc} failed: ${error.message}`)
    const c = (Array.isArray(claim) ? claim[0] : null) as { total: number; previously_seen: number; last_summary_at: string | null } | null
    if (!c) return

    const { data: rowsData } = await supabase
        .from('spectrum_messages')
        .select('role, content, created_at')
        .eq('chat_guid', chatGuid)
        .order('created_at', { ascending: false })
        .limit(SUMMARIZE_MAX + HISTORY_WINDOW)
    const rows = ((rowsData ?? []) as Row[]).filter((r) => r.role === 'user' || r.role === 'assistant').reverse()
    if (!rows.length) return

    // 1. Profile + facts from the messages since the last update.
    const fresh = rows.slice(-Math.min(Math.max(c.total - c.previously_seen, UPDATE_EVERY), 30))
    const [ctxRpc, ctxArgs] = userId
        ? ['dinghy_user_memory_context', { p_user_id: userId }]
        : ['dinghy_memory_context', { p_chat_guid: chatGuid }]
    const [recentRpc, recentArgs] = userId
        ? ['recent_user_memories', { p_user_id: userId, p_limit: 30 }]
        : ['recent_chat_memories', { p_chat_guid: chatGuid, p_limit: 30 }]
    const [{ data: ctx }, { data: recent }] = await Promise.all([
        supabase.rpc(ctxRpc as string, ctxArgs),
        supabase.rpc(recentRpc as string, recentArgs),
    ])
    const profile = ((ctx ?? {}) as { profile?: string }).profile ?? ''
    const known = ((recent ?? []) as { content: string }[]).map((r) => r.content)
    const knownPlans = userId ? await loadUpcomingPlans(userId).catch(() => []) : []
    const out = await gatewayJson(
        PROFILE_SYSTEM.replace('{TODAY}', new Date().toISOString().slice(0, 10)),
        `current profile:\n${profile || '(empty)'}\n\nknown facts:\n${known.map((k) => `- ${k}`).join('\n') || '(none)'}\n\nknown plans:\n${knownPlans.map((p) => `- ${renderPlan(p)}`).join('\n') || '(none)'}\n\nrecent messages:\n${transcript(fresh, 6000)}`,
        1100
    )
    if (out) {
        const nextProfile = cleanProfile(out.profile)
        if (nextProfile) {
            const [saveRpc, saveArgs] = userId
                ? ['save_dinghy_user_profile', { p_user_id: userId, p_profile: nextProfile }]
                : ['save_dinghy_profile', { p_chat_guid: chatGuid, p_profile: nextProfile }]
            await supabase.rpc(saveRpc as string, saveArgs)
        }
        await storeFacts(chatGuid, userId, sourceChannel, cleanFacts(out.facts, known))
        if (userId) await savePlans(userId, chatGuid, cleanPlans(out.plans)).catch((err) => console.error('[dinghy] plans save failed', err instanceof Error ? err.message : err))
    }

    // 2. Episodic summary of what scrolled out of the history window.
    const since = c.last_summary_at ? Date.parse(c.last_summary_at) : 0
    const outOfWindow = rows.slice(0, Math.max(0, rows.length - HISTORY_WINDOW)).filter((r) => Date.parse(r.created_at) > since)
    if (outOfWindow.length >= SUMMARIZE_MIN) {
        const chunk = outOfWindow.slice(0, SUMMARIZE_MAX)
        const s = await gatewayJson(SUMMARY_SYSTEM, transcript(chunk, 8000), 300)
        const summary = typeof s?.summary === 'string' ? s.summary.trim() : ''
        if (summary && !looksSecret(summary)) {
            const vec = await embedText(summary)
            await supabase.rpc('add_conversation_summary_v2', {
                p_chat_guid: chatGuid,
                p_summary: summary,
                p_message_count: chunk.length,
                p_first_at: chunk[0].created_at,
                p_last_at: chunk[chunk.length - 1].created_at,
                p_embedding: vec ? JSON.stringify(vec) : null,
                p_model: vec ? currentEmbeddingModel() : null,
            })
        }
    }

    // 3. Vectors for anything written without one, or under an old model.
    await backfillEmbeddings(chatGuid).catch(() => 0)
}

/**
 * Give vectors to rows that have none (written while embeddings were down)
 * or that came from a different model (after a model switch). Bounded per
 * pass; runs inside the after-reply memory update.
 */
export async function backfillEmbeddings(chatGuid: string, limit = 20): Promise<number> {
    const supabase = createServerClient()
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const [rpc, args] = userId
        ? ['user_rows_needing_embedding', { p_user_id: userId, p_model: currentEmbeddingModel(), p_limit: limit }]
        : ['chat_rows_needing_embedding', { p_chat_guid: chatGuid, p_model: currentEmbeddingModel(), p_limit: limit }]
    const { data, error } = await supabase.rpc(rpc as string, args)
    if (error || !Array.isArray(data)) return 0
    let n = 0
    for (const r of data as { kind: string; id: string; content: string }[]) {
        const vec = await embedText(r.content)
        if (!vec) break // embeddings unavailable; try again next pass
        const { error: e } = await supabase.rpc('set_chat_embedding', {
            p_kind: r.kind,
            p_id: r.id,
            p_embedding: JSON.stringify(vec),
            p_model: currentEmbeddingModel(),
        })
        if (!e) n++
    }
    return n
}

/** "forget X" — soft-deletes matching facts (reversible), user-wide when bound. */
export async function forgetMemories(chatGuid: string, match: string): Promise<number> {
    const userId = await resolveUserId(chatGuid).catch(() => null)
    const [rpc, args] = userId
        ? ['forget_user_memories', { p_user_id: userId, p_match: match }]
        : ['forget_chat_memories', { p_chat_guid: chatGuid, p_match: match }]
    const { data, error } = await createServerClient().rpc(rpc as string, args)
    if (error) throw new Error(`${rpc} failed: ${error.message}`)
    return (data as number) ?? 0
}
