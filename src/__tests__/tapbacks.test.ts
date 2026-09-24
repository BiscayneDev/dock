import { describe, expect, it, vi } from 'vitest'
import { ackTapback, normalizeInbound, reactionDecision, shouldThread, tapback, withReplyContext } from '@/lib/spectrum/tapbacks'

const preview = 'send this email?\n\nto: a@b.com\nsubject: hi\n\nbody\n\nreply y to send, n to cancel'

describe('normalizeInbound', () => {
    it('plain text', () => {
        expect(normalizeInbound({ content: { type: 'text', text: 'hey' } })).toEqual({ kind: 'text', text: 'hey' })
    })
    it('threaded reply unwraps and keeps the target', () => {
        const n = normalizeInbound({
            content: { type: 'reply', content: { type: 'text', text: 'yes that one' }, target: { direction: 'outbound', content: { type: 'text', text: 'which flight?' } } },
        })
        expect(n).toEqual({ kind: 'text', text: 'yes that one', replyTo: { text: 'which flight?', fromAgent: true } })
    })
    it('tapback', () => {
        expect(normalizeInbound({ content: { type: 'reaction', emoji: '👍', target: { content: { type: 'text', text: preview } } } })).toEqual({
            kind: 'reaction',
            emoji: '👍',
            targetText: preview,
        })
    })
    it('other content is ignored', () => {
        expect(normalizeInbound({ content: { type: 'voice' } })).toBeNull()
    })
})

describe('reactionDecision', () => {
    it('👍 / ❤️ on the draft preview = yes, 👎 = no', () => {
        expect(reactionDecision('👍', preview)).toBe('yes')
        expect(reactionDecision('❤️', preview)).toBe('yes')
        expect(reactionDecision('👎', preview)).toBe('no')
    })
    it('anything else is just a reaction', () => {
        expect(reactionDecision('😂', preview)).toBeNull()
        expect(reactionDecision('👍', 'here is your weather')).toBeNull()
    })
})

describe('ackTapback', () => {
    it('thanks gets ❤️, ok gets 👍', () => {
        expect(ackTapback('thanks!', 'done - added to your calendar')).toBe('❤️')
        expect(ackTapback('got it', 'your flight is at 7:40')).toBe('👍')
    })
    it('never swallows an answer to a question', () => {
        expect(ackTapback('ok', 'want me to draft it?')).toBeNull()
    })
    it('real messages still get words', () => {
        expect(ackTapback('ok what about friday', null)).toBeNull()
    })
})

describe('tapback', () => {
    it('reacts and returns the handle', async () => {
        const handle = { unsend: vi.fn() }
        const react = vi.fn().mockResolvedValue(handle)
        expect(await tapback({ content: { type: 'text' }, react }, '👀')).toBe(handle)
        expect(react).toHaveBeenCalledWith('👀')
    })
    it('never throws', async () => {
        const react = vi.fn().mockRejectedValue(new Error('nope'))
        expect(await tapback({ content: { type: 'text' }, react }, '👀')).toBeNull()
        expect(await tapback({ content: { type: 'text' } }, '👀')).toBeNull()
    })
})

describe('threading', () => {
    it('threads when they replied in-thread', () => {
        expect(shouldThread({ replyTo: { text: 'x', fromAgent: true } }, [], 'a')).toBe(true)
    })
    it('threads when they sent more while we worked', () => {
        const recent = [
            { role: 'user', content: 'find my flight' },
            { role: 'user', content: 'also the hotel' },
        ]
        expect(shouldThread({}, recent, 'find my flight')).toBe(true)
        expect(shouldThread({}, recent, 'also the hotel')).toBe(false)
    })
    it('model sees what they replied to', () => {
        expect(withReplyContext('yes', { text: 'which flight?', fromAgent: true })).toContain('reply to your earlier message: "which flight?"')
        expect(withReplyContext('yes')).toBe('yes')
    })
})
