/**
 * Minimal RFC 5545 .ics generation for confirmed calendar invites (C5).
 * Pure function — no I/O, fully unit-tested. iMessage gets the file as a
 * native attachment so the invite can be tapped into any calendar app.
 */

export interface IcsEvent {
    summary: string
    /** ISO 8601 datetime, or a plain YYYY-MM-DD date for all-day events. */
    start: string
    end: string
    attendees?: string[]
    location?: string
    description?: string
    /** Organizer email; included as ORGANIZER when known. */
    organizer?: string
}

/** RFC 5545 §3.3.11 TEXT escaping. */
export function escapeIcsText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** ISO datetime → basic format UTC (20260923T140000Z); date-only passes through. */
export function icsDateTime(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replace(/-/g, '')
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return value
    return (
        d.getUTCFullYear().toString().padStart(4, '0') +
        String(d.getUTCMonth() + 1).padStart(2, '0') +
        String(d.getUTCDate()).padStart(2, '0') +
        'T' +
        String(d.getUTCHours()).padStart(2, '0') +
        String(d.getUTCMinutes()).padStart(2, '0') +
        String(d.getUTCSeconds()).padStart(2, '0') +
        'Z'
    )
}

/** Fold content lines longer than 75 octets (RFC 5545 §3.1). */
function foldLine(line: string): string {
    if (line.length <= 75) return line
    const parts: string[] = [line.slice(0, 75)]
    let rest = line.slice(75)
    while (rest.length > 0) {
        parts.push(' ' + rest.slice(0, 74))
        rest = rest.slice(74)
    }
    return parts.join('\r\n')
}

export function buildIcs(ev: IcsEvent): string {
    const uid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@dinghy`
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(ev.start)
    const lines: string[] = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Dinghy//Briefing Presence//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${icsDateTime(new Date().toISOString())}`,
        allDay ? `DTSTART;VALUE=DATE:${icsDateTime(ev.start)}` : `DTSTART:${icsDateTime(ev.start)}`,
        allDay ? `DTEND;VALUE=DATE:${icsDateTime(ev.end)}` : `DTEND:${icsDateTime(ev.end)}`,
        `SUMMARY:${escapeIcsText(ev.summary)}`,
    ]
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`)
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`)
    if (ev.organizer) lines.push(`ORGANIZER;CN=${escapeIcsText(ev.organizer)}:mailto:${ev.organizer}`)
    for (const a of ev.attendees ?? []) {
        lines.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;CN=${escapeIcsText(a)}:mailto:${a}`)
    }
    lines.push('END:VEVENT', 'END:VCALENDAR')
    return lines.map(foldLine).join('\r\n') + '\r\n'
}
