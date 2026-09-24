import { describe, it, expect, vi } from 'vitest'

vi.mock('spectrum-ts', () => ({
    richlink: (url: string) => ({ type: 'richlink', url }),
}))
const enqueueOutbox = vi.fn(async (_c: string, _k: string, _t: string) => 'ob1')
const markOutboxSent = vi.fn(async (_id: string) => {})
const markOutboxFailed = vi.fn(async (_row: unknown, _err: unknown) => {})
vi.mock('@/lib/spectrum/outbox', () => ({
    enqueueOutbox: (c: string, k: string, t: string) => enqueueOutbox(c, k, t),
    markOutboxSent: (id: string) => markOutboxSent(id),
    markOutboxFailed: (row: unknown, err: unknown) => markOutboxFailed(row, err),
}))

import { sendLink, splitStandaloneUrl } from '@/lib/spectrum/links'

describe('splitStandaloneUrl', () => {
    it('splits a trailing bare url out of the reply', () => {
        expect(splitStandaloneUrl('here you go:\nhttps://getdinghy.sh/connect?token=abc')).toEqual({
            text: 'here you go:',
            url: 'https://getdinghy.sh/connect?token=abc',
        })
    })

    it('handles a url-only reply', () => {
        expect(splitStandaloneUrl('https://example.com/x')).toEqual({ text: '', url: 'https://example.com/x' })
    })

    it('ignores trailing blank lines', () => {
        expect(splitStandaloneUrl('see this\nhttps://example.com\n\n')).toEqual({ text: 'see this', url: 'https://example.com' })
    })

    it('leaves inline links and mid-reply urls in the text', () => {
        expect(splitStandaloneUrl('check https://example.com - it has the answer')).toEqual({
            text: 'check https://example.com - it has the answer',
            url: null,
        })
        expect(splitStandaloneUrl('https://example.com\nwhat do you think?')).toEqual({
            text: 'https://example.com\nwhat do you think?',
            url: null,
        })
        expect(splitStandaloneUrl('no links here')).toEqual({ text: 'no links here', url: null })
    })
})

describe('sendLink', () => {
    it('sends a richlink bubble and stores the bare url in the outbox', async () => {
        const sent: unknown[] = []
        await sendLink({ send: async (c) => void sent.push(c) }, 'chat1', 'connect_link', 'https://x.test/a')
        expect(sent).toEqual([{ type: 'richlink', url: 'https://x.test/a' }])
        expect(enqueueOutbox).toHaveBeenCalledWith('chat1', 'connect_link', 'https://x.test/a')
        expect(markOutboxSent).toHaveBeenCalledWith('ob1')
        expect(markOutboxFailed).not.toHaveBeenCalled()
    })

    it('falls back to the bare url when the rich send fails', async () => {
        const sent: unknown[] = []
        let calls = 0
        await sendLink(
            {
                send: async (c) => {
                    calls++
                    if (calls === 1) throw new Error('richlink rejected')
                    sent.push(c)
                },
            },
            'chat1',
            'reply',
            'https://x.test/b'
        )
        expect(sent).toEqual(['https://x.test/b'])
        expect(markOutboxSent).toHaveBeenCalledWith('ob1')
    })

    it('marks the outbox row failed when both sends fail', async () => {
        markOutboxFailed.mockClear()
        await sendLink(
            {
                send: async () => {
                    throw new Error('down')
                },
            },
            'chat1',
            'reply',
            'https://x.test/c'
        )
        expect(markOutboxFailed).toHaveBeenCalledWith(
            { id: 'ob1', chat_guid: 'chat1', kind: 'reply', text: 'https://x.test/c', attempts: 0 },
            expect.any(Error)
        )
    })
})
