import { describe, expect, it } from 'vitest'
import { decideBrief, lastTextByChat, LIVE_CONVERSATION_MS } from '@/lib/spectrum/proactive-gate'

const base = { localHour: 8, forced: false, inQuietHours: false, sinceLastUserTextMs: null }

describe('decideBrief', () => {
    it('acts at 8am for an idle user', () => expect(decideBrief(base)).toEqual({ act: 'now' }))
    it('skips outside the morning window', () => {
        expect(decideBrief({ ...base, localHour: 7 })).toEqual({ act: 'skip', reason: 'not_due' })
        expect(decideBrief({ ...base, localHour: 10 })).toEqual({ act: 'skip', reason: 'not_due' })
    })
    it('skips in quiet hours', () => expect(decideBrief({ ...base, inQuietHours: true })).toEqual({ act: 'skip', reason: 'quiet_hours' }))
    it('does not interrupt a live conversation at 8, looks again in an hour', () => {
        expect(decideBrief({ ...base, sinceLastUserTextMs: 60_000 })).toEqual({ act: 'wait', reason: 'live_conversation', recheckInMinutes: 60 })
    })
    it('sends at the last hour even mid-conversation, so the brief is never lost', () => {
        expect(decideBrief({ ...base, localHour: 9, sinceLastUserTextMs: 60_000 })).toEqual({ act: 'now' })
    })
    it('an old text is not a live conversation', () => {
        expect(decideBrief({ ...base, sinceLastUserTextMs: LIVE_CONVERSATION_MS + 1 })).toEqual({ act: 'now' })
    })
    it('"brief me now" ignores window, quiet hours and conversation', () => {
        expect(decideBrief({ localHour: 3, forced: true, inQuietHours: true, sinceLastUserTextMs: 1 })).toEqual({ act: 'now' })
    })
})

describe('lastTextByChat', () => {
    it('keeps the newest time per chat and ignores bad dates', () => {
        const m = lastTextByChat([
            { chat_guid: 'a', created_at: '2026-10-09T12:00:00Z' },
            { chat_guid: 'a', created_at: '2026-10-09T12:05:00Z' },
            { chat_guid: 'b', created_at: 'nope' },
        ])
        expect(m.get('a')).toBe(Date.parse('2026-10-09T12:05:00Z'))
        expect(m.has('b')).toBe(false)
    })
})
