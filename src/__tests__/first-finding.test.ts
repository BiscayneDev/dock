import { describe, expect, it } from 'vitest'
import { formatFirstFinding, senderName } from '@/lib/spectrum/first-finding'
import { FIRST_USE_SUGGESTIONS, GOOGLE_CONNECT_ASK } from '@/lib/spectrum/connect-lines'

const now = new Date('2026-10-02T14:00:00Z')
const tz = 'America/New_York'

describe('first finding', () => {
    it('says nothing when there is nothing real', () => {
        expect(formatFirstFinding(null, null, now, tz)).toBeNull()
        expect(formatFirstFinding({ summary: '  ', start: now, allDay: false }, { from: 'a@b.c', subject: '' }, now, tz)).toBeNull()
    })
    it('names the next event with a relative day and local time', () => {
        const out = formatFirstFinding({ summary: 'Design review', start: new Date('2026-10-03T18:30:00Z'), allDay: false }, null, now, tz)
        expect(out).toContain('"Design review" tomorrow at 2:30 PM')
    })
    it('names an unread sender and subject, and works alone', () => {
        const out = formatFirstFinding(null, { from: 'Sam Lee <sam@x.com>', subject: 'Contract draft' }, now, tz)
        expect(out).toContain('Sam Lee emailed you "Contract draft"')
        expect(out).not.toContain('calendar')
    })
    it('collapses newlines and truncates long subjects', () => {
        const out = formatFirstFinding(null, { from: 'a@b.c', subject: `x\n${'y'.repeat(200)}` }, now, tz)!
        expect(out).not.toContain('\n')
        expect(out.length).toBeLessThan(200)
    })
    it('parses sender names', () => {
        expect(senderName('"Lee, Sam" <s@x.com>')).toBe('Lee, Sam')
        expect(senderName('s@x.com')).toBe('s@x.com')
    })
})

describe('onboarding copy', () => {
    it('is plain, never "can\'t", and states only true access claims', () => {
        for (const t of [GOOGLE_CONNECT_ASK, FIRST_USE_SUGGESTIONS]) expect(t).not.toMatch(/[*_`#—]|can't|cannot/i)
        expect(GOOGLE_CONNECT_ASK).toMatch(/disconnect any time/i)
        expect(GOOGLE_CONNECT_ASK).not.toMatch(/delete|erase|private/i)
    })
})
