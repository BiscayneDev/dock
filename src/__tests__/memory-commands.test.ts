import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
    createServerClient: () => ({ rpc: rpcMock, from: fromMock }),
}))

vi.mock('@/lib/spectrum/memory', () => ({
    forgetMemories: vi.fn(),
    resolveUserId: vi.fn(async () => null),
}))

import { forgetMemories, resolveUserId } from '@/lib/spectrum/memory'
import {
    handlePendingMemoryWipe,
    isMemoryCommand,
    parseForgetIntent,
    renderMemoryReport,
    WIPE_PROMPT,
} from '@/lib/spectrum/memory-commands'

// Generic table builder: each from('table') call gets a fresh chain that
// records its method calls; tests seed results per table.
function makeBuilder(table: string, results: Record<string, any>) {
    const b: Record<string, unknown> = {
        upsert: (row: unknown) => {
            ;(results.upserts ??= []).push({ table, row })
            return Promise.resolve({ data: null, error: null })
        },
        select: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve(results.maybeSingle ?? { data: null, error: null }),
        delete: () => {
            ;(results.deletes ??= []).push(table)
            return b
        },
    }
    return b
}

let tables: Record<string, unknown> = {}
beforeEach(() => {
    rpcMock.mockReset()
    fromMock.mockReset()
    tables = {}
    fromMock.mockImplementation((table: string) => makeBuilder(table, (tables[table] ??= {}) as Record<string, any>))
    vi.mocked(resolveUserId).mockResolvedValue(null)
    vi.mocked(forgetMemories).mockResolvedValue(1)
})

describe('isMemoryCommand', () => {
    it('matches /memory and plain-language asks', () => {
        for (const s of ['/memory', '  /Memory ', 'what do you know about me', 'what do you remember about me?'])
            expect(isMemoryCommand(s)).toBe(true)
    })
    it('ignores ordinary messages', () => {
        for (const s of ['memory of the trip', '/remind me', 'do you know about me']) expect(isMemoryCommand(s)).toBe(false)
    })
})

describe('parseForgetIntent', () => {
    it('parses match intents with common phrasings', () => {
        expect(parseForgetIntent('forget that my sister is Pia')).toEqual({ kind: 'match', match: 'my sister is pia' })
        expect(parseForgetIntent('forget about the trip')).toEqual({ kind: 'match', match: 'the trip' })
        expect(parseForgetIntent('forget I said I like sushi')).toEqual({ kind: 'match', match: 'i like sushi' })
        expect(parseForgetIntent('Please forget Miami')).toEqual({ kind: 'match', match: 'miami' })
    })
    it('parses wipe-all intents', () => {
        for (const s of ['forget everything', 'forget everything about me', 'forget it all', 'wipe your memory', 'please forget all of it'])
            expect(parseForgetIntent(s)).toEqual({ kind: 'all' })
    })
    it('never fires on idioms or non-forget texts', () => {
        for (const s of ['forget it', 'forget that', "can't forget that day", 'remember the alamo', 'hello'])
            expect(parseForgetIntent(s)).toBeNull()
    })
})

describe('renderMemoryReport', () => {
    it('renders a lowercase list of profile + recent facts (guest chat)', async () => {
        rpcMock.mockImplementation(async (fn: string) => {
            if (fn === 'dinghy_memory_context') return { data: { profile: '- name: Halsey\n- lives in Miami', summaries: [] }, error: null }
            if (fn === 'recent_chat_memories') return { data: [{ content: 'Halsey' }, { content: 'sister is Pia' }], error: null }
            return { data: null, error: null }
        })
        const out = await renderMemoryReport('chat-1')
        expect(out).toContain("here's what i remember about you:")
        expect(out).toContain('- name: Halsey')
        expect(out).toContain('- lives in Miami')
        expect(out).toContain('- sister is Pia')
        expect(out).toContain('forget everything')
    })
    it('says when nothing is known', async () => {
        rpcMock.mockResolvedValue({ data: { profile: '', summaries: [] }, error: null })
        const out = await renderMemoryReport('chat-1')
        expect(out).toContain('nothing saved about you yet')
    })
    it('uses the user-keyed RPCs when the chat is bound', async () => {
        vi.mocked(resolveUserId).mockResolvedValue('u-1')
        rpcMock.mockResolvedValue({ data: { profile: '- x', summaries: [] }, error: null })
        await renderMemoryReport('chat-1')
        expect(rpcMock).toHaveBeenCalledWith('dinghy_user_memory_context', { p_user_id: 'u-1' })
        expect(rpcMock).toHaveBeenCalledWith('recent_user_memories', { p_user_id: 'u-1', p_limit: 10 })
    })
})

describe('wipe-all gate', () => {
    it('no open gate → the message flows on untouched', async () => {
        await expect(handlePendingMemoryWipe('chat-1', 'YES')).resolves.toBeNull()
    })
    it('only an explicit yes wipes; anything else cancels and keeps everything', async () => {
        tables.dinghy_memory_wipes = { maybeSingle: { data: { chat_guid: 'chat-1' }, error: null } }
        rpcMock.mockResolvedValue({ data: 3, error: null })
        await expect(handlePendingMemoryWipe('chat-1', 'YES')).resolves.toContain('wiped everything')
        expect(rpcMock).toHaveBeenCalledWith('forget_all_chat_memories', { p_chat_guid: 'chat-1' })
        expect((tables.dinghy_memory_wipes as { deletes: unknown[] }).deletes).toHaveLength(1)

        tables.dinghy_memory_wipes = { maybeSingle: { data: { chat_guid: 'chat-1' }, error: null } }
        await expect(handlePendingMemoryWipe('chat-1', 'yes.')).resolves.toContain('wiped everything')

        tables.dinghy_memory_wipes = { maybeSingle: { data: { chat_guid: 'chat-1' }, error: null } }
        await expect(handlePendingMemoryWipe('chat-1', 'no wait')).resolves.toContain('kept everything')
        await expect(handlePendingMemoryWipe('chat-1', 'ok sure')).resolves.toContain('kept everything')
    })
    it('WIPE_PROMPT demands an explicit YES', () => {
        expect(WIPE_PROMPT).toContain('reply YES')
        expect(WIPE_PROMPT).toContain('everything')
    })
})

describe('forgetMatch passthrough', () => {
    it('delegates to memory.forgetMemories', async () => {
        vi.mocked(forgetMemories).mockResolvedValue(2)
        const { forgetMatch } = await import('@/lib/spectrum/memory-commands')
        await expect(forgetMatch('chat-1', 'sister is pia')).resolves.toBe(2)
        expect(forgetMemories).toHaveBeenCalledWith('chat-1', 'sister is pia')
    })
})
