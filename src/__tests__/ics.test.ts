import { describe, it, expect } from 'vitest'
import { buildIcs, escapeIcsText, icsDateTime } from '@/lib/spectrum/ics'

describe('escapeIcsText', () => {
    it('escapes per RFC 5545 §3.3.11', () => {
        expect(escapeIcsText('a,b;c\nd')).toBe('a\\,b\\;c\\nd')
        expect(escapeIcsText('back\\slash')).toBe('back\\\\slash')
    })
})

describe('icsDateTime', () => {
    it('converts ISO datetimes to basic UTC format', () => {
        expect(icsDateTime('2026-09-23T10:00:00-04:00')).toBe('20260923T140000Z')
    })
    it('keeps date-only values as basic dates', () => {
        expect(icsDateTime('2026-09-23')).toBe('20260923')
    })
})

describe('buildIcs', () => {
    const ev = {
        summary: 'Lunch, with Mara; et. al.',
        start: '2026-09-23T12:00:00-04:00',
        end: '2026-09-23T13:00:00-04:00',
        attendees: ['mara@example.com', 'sam@example.com'],
        location: 'Cafe Zero',
    }

    const ics = buildIcs(ev)

    it('produces a minimal valid VCALENDAR with attendees', () => {
        const lines = ics.split('\r\n')
        expect(lines[0]).toBe('BEGIN:VCALENDAR')
        expect(lines.at(-2)).toBe('END:VCALENDAR')
        expect(ics).toContain('VERSION:2.0')
        expect(ics).toContain('SUMMARY:Lunch\\, with Mara\\; et. al.')
        expect(ics).toContain('DTSTART:20260923T160000Z')
        expect(ics).toContain('DTEND:20260923T170000Z')
        expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;CN=mara@example.com:mailto:mara@example.com')
        expect(ics).toContain('ATTENDEE;ROLE=REQ-PARTICIPANT;CN=sam@example.com:mailto:sam@example.com')
        expect(ics).toContain('UID:')
        expect(ics).toContain('DTSTAMP:')
        expect(ics.endsWith('\r\n')).toBe(true)
    })

    it('marks all-day events with VALUE=DATE', () => {
        const allDay = buildIcs({ ...ev, start: '2026-09-23', end: '2026-09-24' })
        expect(allDay).toContain('DTSTART;VALUE=DATE:20260923')
        expect(allDay).toContain('DTEND;VALUE=DATE:20260924')
    })

    it('folds lines longer than 75 octets', () => {
        const long = buildIcs({ ...ev, summary: 'x'.repeat(120) })
        for (const line of long.split('\r\n')) {
            expect(line.length).toBeLessThanOrEqual(75)
        }
        // unfold recovers the summary
        expect(long.replace(/\r\n /g, '')).toContain(`SUMMARY:${'x'.repeat(120)}`)
    })

    it('includes a single attendee line per attendee and no ORGANIZER when absent', () => {
        expect(ics).not.toContain('ORGANIZER')
        expect((ics.match(/ATTENDEE/g) ?? []).length).toBe(2)
    })
})
