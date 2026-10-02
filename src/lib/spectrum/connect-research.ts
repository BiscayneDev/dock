/**
 * "Getting to know you" right after Google connects. Read-only and headers only:
 * calendar titles/times/attendee names for the next 14 days, and sender/recipient
 * names plus subjects (never bodies) from the last 30-60 days. No model, no
 * invention: everything said and saved is counted straight from those headers.
 * A few short notes go to memory (say "forget X" removes them) so Dinghy knows
 * who matters from the first day. Turn off with DINGHY_CONNECT_RESEARCH=off.
 */
import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/integrations/google'
import type { DecryptedTokens } from '@/lib/llm/types'
import { createServerClient } from '@/lib/supabase/server'
import { senderName } from './first-finding'
import { storeFacts } from './memory'
import { FIRST_USE_QUESTION } from './connect-lines'

export const RESEARCH_MARKER = 'Dinghy read their recent calendar and mail headers when Google was connected.'

export function researchEnabled(): boolean {
    return (process.env.DINGHY_CONNECT_RESEARCH ?? 'on').toLowerCase() !== 'off'
}

export const RESEARCH_START_LINE =
    "Reading your last month of calendar and inbox now - who you write to and when, never message bodies - to learn who and what matters. Back in a minute."

export interface Signals {
    /** Display names of people they received mail from (non-bulk), one entry per message. */
    from: string[]
    /** Display names of people they wrote to, one entry per sent message. */
    to: string[]
    events: Array<{ summary: string; start: Date; recurring: boolean; attendees: string[] }>
}

const BULK = /no-?reply|donotreply|notifications?@|mailer-daemon|newsletter|@.*\.(?:mailchimp|sendgrid)/i
const first = (name: string): string => name.split(/\s+/)[0] ?? name

export function topPeople(names: string[], limit: number, min = 2): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>()
    for (const n of names) {
        const key = n.trim()
        if (!key || key.length < 2 || key.includes('@') || BULK.test(key)) continue
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, count]) => ({ name, count }))
}

export interface Digest {
    people: Array<{ name: string; count: number }>
    recurring: string[]
    eventCount: number
    busiestDay: string | null
}

export function buildDigest(s: Signals, tz: string): Digest {
    const people = topPeople([...s.to, ...s.from], 5)
    const recurring = [...new Set(s.events.filter((e) => e.recurring && e.summary.trim()).map((e) => e.summary.trim().slice(0, 60)))].slice(0, 3)
    const perDay = new Map<string, number>()
    for (const e of s.events) {
        const d = e.start.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })
        perDay.set(d, (perDay.get(d) ?? 0) + 1)
    }
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0]
    return { people, recurring, eventCount: s.events.length, busiestDay: busiest && busiest[1] >= 2 ? busiest[0] : null }
}

/** Plain-text result for the chat, or null when there is nothing real to say. */
export function formatDigest(d: Digest): string | null {
    const parts: string[] = []
    if (d.people.length) parts.push(`The people you deal with most: ${d.people.map((p) => p.name).join(', ')}.`)
    if (d.eventCount) {
        const rec = d.recurring.length ? ` Regulars: ${d.recurring.map((r) => `"${r}"`).join(', ')}.` : ''
        const busy = d.busiestDay ? ` ${d.busiestDay} looks busiest.` : ''
        parts.push(`You have ${d.eventCount} event${d.eventCount === 1 ? '' : 's'} in the next two weeks.${busy}${rec}`)
    }
    if (!parts.length) return null
    return `Done reading. ${parts.join(' ')} I saved a few notes so I know who matters. Say "forget <name>" to remove any. ${FIRST_USE_QUESTION}`
}

/** Short memory notes from the digest (no bodies, nothing guessed). */
export function digestFacts(d: Digest): Array<{ content: string; type: string }> {
    const facts: Array<{ content: string; type: string }> = d.people.map((p) => ({ content: `Emails often with ${p.name} (${first(p.name)}); seen in their recent mail headers.`, type: 'person' }))
    for (const r of d.recurring) facts.push({ content: `Has a recurring calendar event called "${r}".`, type: 'event' })
    facts.push({ content: RESEARCH_MARKER, type: 'fact' })
    return facts.slice(0, 9)
}

export async function readSignals(tokens: DecryptedTokens, userId: string, now: Date = new Date()): Promise<Signals> {
    const auth = await getAuthedClient(tokens, userId)
    const cal = google.calendar({ version: 'v3', auth })
    const gmail = google.gmail({ version: 'v1', auth })
    const bulk = '-category:promotions -category:social -category:updates -category:forums'
    const [events, inbox, sent] = await Promise.all([
        cal.events.list({ calendarId: 'primary', timeMin: now.toISOString(), timeMax: new Date(now.getTime() + 14 * 86400000).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 40 }).catch(() => null),
        gmail.users.messages.list({ userId: 'me', q: `in:inbox newer_than:30d ${bulk}`, maxResults: 40 }).catch(() => null),
        gmail.users.messages.list({ userId: 'me', q: 'in:sent newer_than:60d', maxResults: 30 }).catch(() => null),
    ])
    const header = async (id: string, names: string[]) => {
        const m = await gmail.users.messages.get({ userId: 'me', id, format: 'metadata', metadataHeaders: names }).catch(() => null)
        return (n: string) => m?.data.payload?.headers?.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? ''
    }
    const from: string[] = []
    const to: string[] = []
    await Promise.all([
        ...(inbox?.data.messages ?? []).map(async (m) => { const h = await header(m.id ?? '', ['From']); const f = h('from'); if (f && !BULK.test(f)) from.push(senderName(f)) }),
        ...(sent?.data.messages ?? []).map(async (m) => { const h = await header(m.id ?? '', ['To']); for (const t of h('to').split(',')) { const n = senderName(t); if (n) to.push(n) } }),
    ])
    const out: Signals['events'] = []
    for (const e of events?.data.items ?? []) {
        if (e.status === 'cancelled' || !e.summary) continue
        const self = (e.attendees ?? []).find((a) => a.self)
        if (self?.responseStatus === 'declined') continue
        const dt = e.start?.dateTime ?? e.start?.date
        if (!dt) continue
        out.push({ summary: e.summary, start: new Date(dt), recurring: Boolean(e.recurringEventId), attendees: (e.attendees ?? []).filter((a) => !a.self).map((a) => a.displayName ?? '').filter(Boolean) })
    }
    return { from, to, events: out }
}

/** True when this user's Google research already ran (reconnects do not repeat it). */
async function alreadyRan(userId: string): Promise<boolean> {
    const { data } = await createServerClient().from('memories').select('id').eq('user_id', userId).eq('content', RESEARCH_MARKER).is('superseded_at', null).limit(1)
    return Boolean(data && data.length)
}

/**
 * Run the pass after a first Google connect. `say` sends one chat message.
 * Never throws; a failure is logged and the user just gets no extra message.
 */
export async function runConnectResearch(args: { chatGuid: string; userId: string; tokens: DecryptedTokens; tz: string; say: (text: string) => Promise<void> }): Promise<'ran' | 'skipped' | 'empty' | 'error'> {
    try {
        if (!researchEnabled() || (await alreadyRan(args.userId))) return 'skipped'
        await args.say(RESEARCH_START_LINE)
        const digest = buildDigest(await readSignals(args.tokens, args.userId), args.tz)
        const text = formatDigest(digest)
        if (!text) return 'empty'
        await storeFacts(args.chatGuid, args.userId, 'google_onboarding', digestFacts(digest))
        await args.say(text)
        return 'ran'
    } catch (err) {
        console.error('connect research failed:', err instanceof Error ? err.message : String(err))
        return 'error'
    }
}
