import { describe, it, expect, vi, beforeEach } from 'vitest'

const fromMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
    createServerClient: () => ({ from: fromMock }),
}))

vi.mock('@/lib/spectrum/memory', () => ({
    storeFacts: vi.fn(async () => 1),
    resolveUserId: vi.fn(async () => null),
    looksSecret: (t: string) => /password|secret/i.test(t),
}))

import { storeFacts } from '@/lib/spectrum/memory'
import { extractName, interviewDirective, isSubstantive, markOpenerAsked } from '@/lib/spectrum/interview'

// dinghy_interviews mock: one row per chat, stage in tables[chatGuid].
const tables: Record<string, number | undefined> = {}
beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k]
    vi.mocked(storeFacts).mockClear()
    fromMock.mockReset()
    fromMock.mockImplementation((table: string) => {
        if (table !== 'dinghy_interviews') throw new Error(`unexpected table ${table}`)
        const b = {
            select: () => b,
            eq: () => b,
            maybeSingle: () => Promise.resolve({ data: tables.chat1 ? { stage: tables.chat1 } : null, error: null }),
            upsert: (row: { stage?: number }, _opts?: { ignoreDuplicates?: boolean }) => {
                if (_opts?.ignoreDuplicates && tables.chat1) return Promise.resolve({ data: null, error: null })
                tables.chat1 = row.stage ?? tables.chat1 ?? 0
                return Promise.resolve({ data: null, error: null })
            },
        }
        return b
    })
})

describe('extractName', () => {
    it('pulls the name out of common phrasings', () => {
        expect(extractName('call me sam')).toBe('Sam')
        expect(extractName("my name's Halsey")).toBe('Halsey')
        expect(extractName("i'm Pia")).toBe('Pia')
    })
    it('rejects filler after i\'m and non-answers', () => {
        expect(extractName("i'm not sure")).toBeNull()
        expect(extractName("i'm working a lot")).toBeNull()
        expect(extractName('mornings are rough')).toBeNull()
    })
})

describe('isSubstantive', () => {
    it('a bare greeting is not an answer', () => {
        expect(isSubstantive('hi')).toBe(false)
        expect(isSubstantive('👍')).toBe(false)
        expect(isSubstantive('ok')).toBe(false)
    })
    it('a real answer is', () => {
        expect(isSubstantive('mostly client work, two launches')).toBe(true)
    })
})

describe('markOpenerAsked', () => {
    it('never resets an existing interview row', async () => {
        tables.chat1 = 3
        await markOpenerAsked('chat-1')
        expect(tables.chat1).toBe(3)
    })
    it('marks a fresh chat as opener-asked (stage 1)', async () => {
        await markOpenerAsked('chat-1')
        expect(tables.chat1).toBe(1)
    })
})

describe('interviewDirective — the 2-question cap', () => {
    it('turn 1: opener answered → asks the name question', async () => {
        tables.chat1 = 1
        const line = await interviewDirective('chat-1', 'deadline crunch all week', 'mostly client work honestly')
        expect(line).toContain('what should I call you')
        expect(tables.chat1).toBe(2)
    })
    it('a one-word opener reply keeps waiting, does not burn a question', async () => {
        tables.chat1 = 1
        expect(await interviewDirective('chat-1', 'hey', 'yo')).toBeNull()
        expect(tables.chat1).toBe(1)
    })
    it('turn 2: name answered and filed as a fact → asks the mornings question', async () => {
        tables.chat1 = 2
        const line = await interviewDirective('chat-1', 'deadline crunch', "i'm Sam")
        expect(line).toContain('mornings')
        expect(tables.chat1).toBe(3)
        expect(storeFacts).toHaveBeenCalledWith('chat-1', null, 'imessage', [{ content: 'goes by Sam', type: 'person' }])
    })
    it('turn 3: mornings answered and filed → interview done, never asks again', async () => {
        tables.chat1 = 3
        expect(await interviewDirective('chat-1', 'hey', 'quiet, coffee then a run')).toBeNull()
        expect(tables.chat1).toBe(4)
        expect(storeFacts).toHaveBeenCalledWith('chat-1', null, 'imessage', [
            { content: 'mornings should look like: quiet, coffee then a run', type: 'preference' },
        ])
        expect(await interviewDirective('chat-1', 'hey', 'anything else')).toBeNull()
        expect(await interviewDirective('chat-1', 'hey', 'another message later on')).toBeNull()
    })
    it('skips the name question when the first message already said it', async () => {
        tables.chat1 = 1
        const line = await interviewDirective('chat-1', "hi dinghy, i'm Sam", 'lots of writing this week')
        expect(line).toContain('mornings')
        expect(line).not.toContain('call you')
    })
    it('skips both questions when the opener reply already covers them', async () => {
        tables.chat1 = 1
        const line = await interviewDirective('chat-1', 'hey', "i'm Sam, and my mornings start early with a run")
        expect(line).toBeNull()
        expect(tables.chat1).toBe(4)
        expect(storeFacts).not.toHaveBeenCalled()
    })
})
