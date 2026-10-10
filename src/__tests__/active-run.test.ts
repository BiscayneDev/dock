import { describe, expect, it } from 'vitest'
import { activeRunsFrom, earlierUserText, steerNote, ACTIVE_RUN_WINDOW_MS, type StageRow } from '@/lib/spectrum/active-run'

const now = Date.parse('2026-10-09T20:00:00Z')
const row = (run_id: string, stage: string, agoMs: number, message_id: string | null = null): StageRow => ({
    run_id, stage, message_id, created_at: new Date(now - agoMs).toISOString(),
})

describe('active runs', () => {
    it('finds a run whose newest stage is not terminal', () => {
        const runs = activeRunsFrom([row('a', 'tool', 5_000, 'm1'), row('a', 'context', 20_000, 'm1')], now)
        expect(runs).toHaveLength(1)
        expect(runs[0].messageId).toBe('m1')
    })
    it('ignores finished, failed and deadline runs', () => {
        for (const stage of ['reply_attempted', 'deadline', 'failed']) {
            expect(activeRunsFrom([row('a', stage, 1_000), row('a', 'tool', 9_000)], now)).toHaveLength(0)
        }
    })
    it('ignores a run silent past the turn limit', () => {
        expect(activeRunsFrom([row('a', 'tool', ACTIVE_RUN_WINDOW_MS + 1_000)], now)).toHaveLength(0)
    })
    it('excludes the current message own run', () => {
        expect(activeRunsFrom([row('a', 'gateway', 1_000, 'm2')], now, 'm2')).toHaveLength(0)
    })
    it('keeps parallel runs ordered oldest first', () => {
        const runs = activeRunsFrom([row('b', 'gateway', 2_000, 'm2'), row('a', 'tool', 1_000, 'm1'), row('a', 'context', 30_000, 'm1')], now)
        expect(runs.map((r) => r.runId)).toEqual(['a', 'b'])
    })
})

describe('steer note', () => {
    it('is null with nothing running', () => expect(steerNote([], 'x')).toBeNull())
    it('names the earlier request and forbids redoing it', () => {
        const note = steerNote([{ runId: 'a', messageId: 'm1', startedAt: now }], 'find me a flight to Lisbon')!
        expect(note).toContain('find me a flight to Lisbon')
        expect(note).toMatch(/Do not redo/)
        expect(note).toMatch(/cannot be pulled back/)
    })
    it('shortens a long earlier request and still works when unknown', () => {
        expect(steerNote([{ runId: 'a', messageId: null, startedAt: now }], 'x'.repeat(500))!.length).toBeLessThan(900)
        expect(steerNote([{ runId: 'a', messageId: null, startedAt: now }], null)).toContain('earlier request')
    })
    it('picks the previous user text, not the current one', () => {
        const h = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'book it' }, { role: 'user', content: 'wait' }]
        expect(earlierUserText(h, 'wait')).toBe('book it')
        expect(earlierUserText([{ role: 'user', content: 'wait' }], 'wait')).toBeNull()
    })
})
