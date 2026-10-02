/**
 * One real finding right after Google connects. No model, no invention:
 * the next calendar event in the coming 36 hours and one unread, non-bulk
 * email from the last 2 days, both read live. When neither exists, nothing
 * is sent.
 */

import { google } from 'googleapis'
import { getAuthedClient } from '@/lib/integrations/google'
import type { DecryptedTokens } from '@/lib/llm/types'

export interface FindingEvent {
    summary: string
    start: Date
    allDay: boolean
}
export interface FindingMail {
    from: string
    subject: string
}

const clean = (s: string, max: number): string => {
    const t = s.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** "Sam Lee <sam@x.com>" -> "Sam Lee"; bare address stays as the address. */
export function senderName(from: string): string {
    const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
    return clean(m ? m[1] : from.replace(/[<>]/g, ''), 40)
}

function whenLabel(start: Date, now: Date, tz: string): string {
    const fmtDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: tz })
    const day = fmtDay(start)
    const today = fmtDay(now)
    const tomorrow = fmtDay(new Date(now.getTime() + 24 * 3600 * 1000))
    const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace(':00', '')
    const label = day === today ? 'today' : day === tomorrow ? 'tomorrow' : start.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz })
    return `${label} at ${time}`
}

/** Plain text, or null when there is nothing real to say. */
export function formatFirstFinding(event: FindingEvent | null, mail: FindingMail | null, now: Date, tz: string): string | null {
    const parts: string[] = []
    if (event && event.summary.trim()) {
        const title = clean(event.summary, 60)
        parts.push(event.allDay ? `You have "${title}" on your calendar.` : `Your next event is "${title}" ${whenLabel(event.start, now, tz)}.`)
    }
    if (mail && mail.subject.trim()) {
        parts.push(`${senderName(mail.from)} emailed you "${clean(mail.subject, 70)}" and it's still unread.`)
    }
    if (parts.length === 0) return null
    return `First look: ${parts.join(' ')} Want me to dig into either?`
}

export async function readFirstFinding(
    tokens: DecryptedTokens,
    userId: string,
    tz: string,
    now: Date = new Date()
): Promise<string | null> {
    const auth = await getAuthedClient(tokens, userId)
    const cal = google.calendar({ version: 'v3', auth })
    const gmail = google.gmail({ version: 'v1', auth })

    const [events, list] = await Promise.all([
        cal.events
            .list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                timeMax: new Date(now.getTime() + 36 * 3600 * 1000).toISOString(),
                singleEvents: true,
                orderBy: 'startTime',
                maxResults: 5,
            })
            .catch(() => null),
        gmail.users.messages
            .list({
                userId: 'me',
                q: 'is:unread in:inbox newer_than:2d -category:promotions -category:social -category:updates -category:forums',
                maxResults: 3,
            })
            .catch(() => null),
    ])

    let event: FindingEvent | null = null
    for (const e of events?.data.items ?? []) {
        if (e.status === 'cancelled' || !e.summary) continue
        const self = (e.attendees ?? []).find((a) => a.self)
        if (self?.responseStatus === 'declined') continue
        const dt = e.start?.dateTime
        if (dt) {
            event = { summary: e.summary, start: new Date(dt), allDay: false }
            break
        }
        if (e.start?.date) {
            event = { summary: e.summary, start: new Date(e.start.date), allDay: true }
            break
        }
    }

    let mail: FindingMail | null = null
    const id = list?.data.messages?.[0]?.id
    if (id) {
        const msg = await gmail.users.messages
            .get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'Subject'] })
            .catch(() => null)
        const h = (n: string) => msg?.data.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? ''
        if (h('subject') && h('from') && !/no-?reply|donotreply|notifications?@/i.test(h('from'))) {
            mail = { from: h('from'), subject: h('subject') }
        }
    }
    return formatFirstFinding(event, mail, now, tz)
}
