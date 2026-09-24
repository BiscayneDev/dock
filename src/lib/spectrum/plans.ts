/**
 * Plans memory (migration 046): trips and events as one updatable record
 * each, instead of loose facts. Upcoming plans ride in every prompt until
 * their end date. Only what the user said, or a source confirmed, is saved;
 * absences ("not booked", "no events") never become memory.
 *
 * Remembered files live here too: every document Dinghy makes is saved with
 * its full Markdown so it can reopen and update it later, in any chat.
 * User-level (bound chats only). Every failure degrades to "no memory".
 */

import { createServerClient } from '@/lib/supabase/server'

export type PlanKind = 'trip' | 'event' | 'other'
export type PlanSource = 'user' | 'file' | 'email' | 'calendar' | 'other'

export interface Plan {
    title: string
    kind: PlanKind
    starts_on: string | null
    ends_on: string | null
    places: string[]
    people: string[]
    details: string
    source: PlanSource
}

export interface PlanRow extends Plan {
    id: string
}

const KINDS = new Set(['trip', 'event', 'other'])
const SOURCES = new Set(['user', 'file', 'email', 'calendar', 'other'])
const PLAN_LIMIT = 6
const MAX_PLANS_PER_UPDATE = 3

// ── Absence guard ────────────────────────────────────────────────────────────

/**
 * A failed lookup is not a fact. Catches "hasn't booked", "not on the
 * calendar", "no events found", "nothing in email" and the like.
 */
const ABSENCE_PATTERNS: RegExp[] = [
    /\b(?:has|have|had)\s*(?:n['’]?t|not)\s+(?:yet\s+)?(?:booked|scheduled|created|added|confirmed|reserved|made)\b/i,
    /\b(?:is|are|was|were)\s*(?:n['’]?t|not)\s+(?:yet\s+)?(?:booked|scheduled|on (?:the|their|his|her|my) calendar|in (?:the|their|his|her|my) (?:e-?mail|inbox|calendar))\b/i,
    /\bnot\s+(?:yet\s+)?(?:booked|scheduled|found|showing|confirmed)\b/i,
    /\bno\s+(?:calendar\s+)?(?:events?|bookings?|reservations?|confirmations?|flights?|hotels?)\s+(?:found|on|in|for|yet|showing)\b/i,
    /\b(?:nothing|none)\s+(?:found|showing|booked|on (?:the|their) calendar|in (?:the|their) (?:e-?mail|inbox))\b/i,
    /\bno (?:record|sign|trace|evidence) of\b/i,
    /\b(?:couldn['’]?t|could not|can['’]?t|cannot|didn['’]?t|did not) (?:find|locate|see)\b/i,
]

export function isAbsence(text: string): boolean {
    return ABSENCE_PATTERNS.some((re) => re.test(text))
}

// ── Cleaning model output ────────────────────────────────────────────────────

const str = (v: unknown, cap: number): string => (typeof v === 'string' ? v.trim().slice(0, cap) : '')
const day = (v: unknown): string | null => {
    const s = str(v, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}
const list = (v: unknown, cap = 8): string[] =>
    Array.isArray(v) ? [...new Set(v.map((x) => str(x, 80)).filter(Boolean))].slice(0, cap) : []

/** Validate model-proposed plans: real title, ISO dates, no absences, bounded sizes. */
export function cleanPlans(raw: unknown): Plan[] {
    if (!Array.isArray(raw)) return []
    const out: Plan[] = []
    for (const p of raw as Record<string, unknown>[]) {
        const title = str(p?.title, 140)
        if (title.length < 2) continue
        const details = str(p?.details, 2000)
        if (isAbsence(title) || (details && isAbsence(details))) continue
        let starts_on = day(p?.starts_on)
        let ends_on = day(p?.ends_on)
        if (starts_on && ends_on && ends_on < starts_on) [starts_on, ends_on] = [ends_on, starts_on]
        const kind = (KINDS.has(String(p?.kind)) ? p.kind : 'trip') as PlanKind
        const source = (SOURCES.has(String(p?.source)) ? p.source : 'user') as PlanSource
        out.push({ title, kind, starts_on, ends_on, places: list(p?.places), people: list(p?.people), details, source })
        if (out.length >= MAX_PLANS_PER_UPDATE) break
    }
    return out
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

function overlaps(a: Plan, b: Plan): boolean {
    if (!a.starts_on || !b.starts_on) return false
    const aEnd = a.ends_on ?? a.starts_on
    const bEnd = b.ends_on ?? b.starts_on
    return a.starts_on <= bEnd && b.starts_on <= aEnd
}

/** The existing plan a new one updates: same title, or overlapping dates with a shared place. */
export function matchPlan(next: Plan, existing: PlanRow[]): PlanRow | null {
    const t = norm(next.title)
    const places = new Set(next.places.map(norm))
    for (const e of existing) {
        const et = norm(e.title)
        if (et === t || (t.length >= 6 && et.includes(t)) || (et.length >= 6 && t.includes(et))) return e
    }
    for (const e of existing) {
        if (overlaps(next, e) && e.places.some((p) => places.has(norm(p)))) return e
    }
    return null
}

/** Merge an update into a stored plan: new values win, lists union, details kept unless replaced. */
export function mergePlan(prev: PlanRow, next: Plan): Plan {
    const union = (a: string[], b: string[]) => {
        const seen = new Set<string>()
        return [...a, ...b].filter((x) => (seen.has(norm(x)) ? false : (seen.add(norm(x)), true))).slice(0, 12)
    }
    return {
        title: next.title || prev.title,
        kind: next.kind || prev.kind,
        starts_on: next.starts_on ?? prev.starts_on,
        ends_on: next.ends_on ?? prev.ends_on,
        places: union(prev.places, next.places),
        people: union(prev.people, next.people),
        details: next.details || prev.details,
        source: next.source || prev.source,
    }
}

// ── Storage ──────────────────────────────────────────────────────────────────

const PLAN_COLS = 'id, title, kind, starts_on, ends_on, places, people, details, source'

export function todayIn(timeZone = 'America/New_York', now = new Date()): string {
    return now.toLocaleDateString('en-CA', { timeZone })
}

/** Active plans that haven't ended (undated ones included), soonest first. */
export async function loadUpcomingPlans(userId: string, today = todayIn()): Promise<PlanRow[]> {
    const { data, error } = await createServerClient()
        .from('dinghy_plans')
        .select(PLAN_COLS)
        .eq('user_id', userId)
        .is('deleted_at', null)
        .or(`ends_on.gte.${today},and(ends_on.is.null,starts_on.gte.${today}),and(ends_on.is.null,starts_on.is.null)`)
        .order('starts_on', { ascending: true, nullsFirst: false })
        .limit(PLAN_LIMIT)
    if (error) throw new Error(`plans load failed: ${error.message}`)
    return (data ?? []) as PlanRow[]
}

export async function savePlans(userId: string, chatGuid: string, plans: Plan[]): Promise<number> {
    if (!plans.length) return 0
    const supabase = createServerClient()
    const { data } = await supabase.from('dinghy_plans').select(PLAN_COLS).eq('user_id', userId).is('deleted_at', null).limit(50)
    const existing = (data ?? []) as PlanRow[]
    let n = 0
    for (const p of plans) {
        const hit = matchPlan(p, existing)
        const row = hit ? mergePlan(hit, p) : p
        const res = hit
            ? await supabase.from('dinghy_plans').update({ ...row, updated_at: new Date().toISOString() }).eq('id', hit.id)
            : await supabase.from('dinghy_plans').insert({ ...row, user_id: userId, chat_guid: chatGuid })
        if (!res.error) n++
        if (hit) Object.assign(hit, row)
    }
    return n
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function renderPlan(p: Plan): string {
    const when = p.starts_on ? (p.ends_on && p.ends_on !== p.starts_on ? `${fmtDay(p.starts_on)} to ${fmtDay(p.ends_on)}` : fmtDay(p.starts_on)) : 'dates not set'
    const bits = [`${p.title} (${when})`]
    if (p.places.length) bits.push(p.places.join(', '))
    if (p.people.length) bits.push(`with ${p.people.join(', ')}`)
    if (p.details) bits.push(p.details.replace(/\s*\n\s*/g, '; '))
    return `${bits.join(' · ')} [source: ${p.source}]`
}

/** "forget the reims trip" → soft-delete plans whose title/places match. */
export async function forgetPlans(userId: string, match: string): Promise<number> {
    const m = norm(match).replace(/^(?:the|my|our)\s+/, '').replace(/\s+(?:trip|plan|plans)$/, '')
    if (m.length < 3) return 0
    const { data } = await createServerClient().from('dinghy_plans').select(PLAN_COLS).eq('user_id', userId).is('deleted_at', null).limit(50)
    const ids = ((data ?? []) as PlanRow[]).filter((p) => norm(p.title).includes(m) || p.places.some((x) => norm(x).includes(m))).map((p) => p.id)
    if (!ids.length) return 0
    const { error } = await createServerClient().from('dinghy_plans').update({ deleted_at: new Date().toISOString() }).in('id', ids)
    return error ? 0 : ids.length
}

// ── Remembered files ─────────────────────────────────────────────────────────

export interface FileRecord {
    title: string
    format: string
    url: string | null
    markdown: string
    expires_at: string | null
    created_at?: string
}

export async function rememberFile(userId: string, chatGuid: string | null, f: FileRecord): Promise<void> {
    const { error } = await createServerClient()
        .from('dinghy_files')
        .insert({ user_id: userId, chat_guid: chatGuid, title: f.title.slice(0, 140), format: f.format, url: f.url, markdown: f.markdown.slice(0, 60_000), expires_at: f.expires_at })
    if (error) throw new Error(`remember file failed: ${error.message}`)
}

export async function recentFiles(userId: string, limit = 5): Promise<FileRecord[]> {
    const { data, error } = await createServerClient()
        .from('dinghy_files')
        .select('title, format, url, expires_at, created_at, markdown')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit)
    if (error) throw new Error(`files load failed: ${error.message}`)
    return (data ?? []) as FileRecord[]
}

/** Newest file whose title matches (or whose link is) the query. */
export async function findFile(userId: string, query: string): Promise<FileRecord | null> {
    const q = query.trim()
    if (!q) return null
    const files = await recentFiles(userId, 30)
    if (/^https?:\/\//.test(q)) return files.find((f) => f.url === q) ?? null
    const words = norm(q).split(' ').filter((w) => w.length >= 3)
    const score = (f: FileRecord) => words.filter((w) => norm(f.title).includes(w) || norm(f.markdown.slice(0, 4000)).includes(w)).length
    const best = files.map((f) => ({ f, s: score(f) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]
    return best?.f ?? null
}

export function renderFileLine(f: FileRecord, today = todayIn()): string {
    const made = f.created_at ? fmtDay(f.created_at.slice(0, 10)) : ''
    const expired = f.expires_at ? f.expires_at.slice(0, 10) < today : false
    const link = f.url && !expired ? ` ${f.url}` : expired ? ' (link expired; remake it to share again)' : ''
    return `${f.title} (${f.format}${made ? `, made ${made}` : ''})${link}`
}

export async function forgetAllPlansAndFiles(userId: string): Promise<number> {
    const now = new Date().toISOString()
    const supabase = createServerClient()
    const [a, b] = await Promise.all([
        supabase.from('dinghy_plans').update({ deleted_at: now }).eq('user_id', userId).is('deleted_at', null).select('id'),
        supabase.from('dinghy_files').update({ deleted_at: now }).eq('user_id', userId).is('deleted_at', null).select('id'),
    ])
    return (a.data?.length ?? 0) + (b.data?.length ?? 0)
}
