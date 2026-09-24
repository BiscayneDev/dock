/**
 * The morning brief as a designed card (src/lib/brand/brief-card.tsx).
 *
 * The model returns the brief as JSON; we render the card and send it as an
 * inline PNG. A plain-text version always travels with it: it's what goes
 * into chat history, and it's what gets sent if the card can't render.
 */

import { attachment } from 'spectrum-ts'
import { renderBriefCard, type BriefCardInput } from '@/lib/brand/brief-card'
import type { CardWeather } from '@/lib/weather/brief-weather'
import { toPlainText } from '@/lib/spectrum/plain-text'

interface Sender {
    send(content: unknown): Promise<unknown>
}

export interface BriefPayload {
    card: BriefCardInput
    text: string
}

/** Instructions appended to the briefing ask so the reply is card-shaped JSON. */
export const BRIEF_JSON_SPEC =
    'Reply with ONLY a JSON object, no prose around it, shaped like: ' +
    '{"opener": "one short first-person line in your voice, lowercase, no emoji", ' +
    '"accent": "optional 2-4 words that finish the opener, shown in italic", ' +
    '"on_deck": [{"when": "9:30 am | all day", "what": "event or date", "note": "optional short nudge"}], ' +
    '"worth": [{"tag": "one word like reply, receipt, invite, bill", "from": "sender name", "what": "what it is, under 8 words"}], ' +
    '"rest": {"count": number of other unread, "from": ["up to 3 sender names, lowercase"]}, ' +
    '"text": "the same brief as one short plain text message, your voice"}. ' +
    'At most 4 on_deck items and 3 worth items. Empty arrays are fine on a quiet day.'

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Parse the model reply into card fields. Null when it isn't usable JSON. */
export function parseBriefReply(
    reply: string,
    meta: { date: string; time: string; weather?: CardWeather | null }
): BriefPayload | null {
    const start = reply.indexOf('{')
    const end = reply.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    let j: Record<string, unknown>
    try {
        j = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
    } catch {
        return null
    }
    const opener = str(j.opener, 140)
    if (!opener) return null
    const arr = (v: unknown): Record<string, unknown>[] =>
        Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
    const onDeck = arr(j.on_deck)
        .slice(0, 4)
        .map((e) => ({ when: str(e.when, 16) || 'today', what: str(e.what, 60), note: str(e.note, 70) || undefined }))
        .filter((e) => e.what)
    const worth = arr(j.worth)
        .slice(0, 3)
        .map((e) => ({ tag: str(e.tag, 10).toLowerCase() || 'email', from: str(e.from, 40), what: str(e.what, 70) }))
        .filter((e) => e.from && e.what)
    const restRaw = j.rest && typeof j.rest === 'object' ? (j.rest as Record<string, unknown>) : null
    const count = restRaw ? Math.max(0, Math.round(Number(restRaw.count) || 0)) : 0
    const rest =
        count > 0
            ? {
                  count,
                  from: (Array.isArray(restRaw!.from) ? restRaw!.from : [])
                      .filter((x): x is string => typeof x === 'string')
                      .slice(0, 3)
                      .map((x) => x.toLowerCase().slice(0, 24)),
              }
            : undefined
    const card: BriefCardInput = {
        date: meta.date,
        time: meta.time,
        opener,
        accent: str(j.accent, 40) || undefined,
        onDeck,
        worth,
        weather: meta.weather ?? undefined,
        rest,
    }
    const text = str(j.text, 1200) || plainBrief(card)
    return { card, text }
}

/** Plain text built from the card fields (used when the model skipped "text"). */
export function plainBrief(c: BriefCardInput): string {
    const lines = [`${c.opener}${c.accent ? ` ${c.accent}` : ''}`]
    if (c.weather) lines.push(`${c.weather.temp}° and ${c.weather.sky} in ${c.weather.place}, high ${c.weather.high}.${c.weather.note ? ` ${c.weather.note}` : ''}`)
    for (const e of c.onDeck) lines.push(`${e.when}: ${e.what}${e.note ? ` (${e.note})` : ''}`)
    for (const e of c.worth) lines.push(`${e.from}: ${e.what}`)
    if (c.rest) lines.push(`${c.rest.count} more${c.rest.from.length ? ` from ${c.rest.from.join(', ')}` : ''}. nothing that needs you.`)
    return lines.join('\n')
}

/** Lowercase card date, e.g. "wednesday, sept 23". */
export function cardDate(d: Date, timeZone: string): string {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone }).toLowerCase()
    let month = d.toLocaleDateString('en-US', { month: 'short', timeZone }).toLowerCase()
    if (month === 'sep') month = 'sept'
    const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone })
    return `${weekday}, ${month} ${day}`
}

export function cardTime(d: Date, timeZone: string): string {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).toLowerCase()
}

export async function renderBriefPng(card: BriefCardInput): Promise<Buffer> {
    const res = renderBriefCard(card)
    return Buffer.from(await res.arrayBuffer())
}

/**
 * Send the card; if it can't render, send the text instead. Throws only if
 * the send itself fails (the outbox sweep retries).
 */
export async function sendBrief(space: Sender, payload: BriefPayload): Promise<{ card: boolean }> {
    let png: Buffer | null = null
    try {
        png = await renderBriefPng(payload.card)
    } catch (err) {
        console.error('[dinghy] brief card render failed, sending text', err instanceof Error ? err.message : err)
    }
    if (png) {
        await space.send(attachment(png, { name: 'morning-brief.png', mimeType: 'image/png' }))
        return { card: true }
    }
    await space.send(toPlainText(payload.text))
    return { card: false }
}
