import { describe, expect, it, vi } from 'vitest'
vi.mock('@/spectrum/store', () => ({ saveMessage: vi.fn(async () => undefined) }))
import { demoGuid, demoSpace, isDemoGuid } from '@/lib/spectrum/demo-chat'
import { saveMessage } from '@/spectrum/store'

describe('demo chat', () => {
    it('only builds guids no real handle can produce', () => {
        expect(demoGuid('DinghyDemo861')).toBe('demo;-;dinghydemo861')
        expect(demoGuid('+12035168398')).toBeNull()
        expect(demoGuid('a')).toBeNull()
        expect(demoGuid('x;-;y')).toBeNull()
        expect(isDemoGuid('any;-;+12035168398')).toBe(false)
        expect(isDemoGuid('demo;-;dinghydemo861')).toBe(true)
    })
    it('captures text and links, ignores typing, persists only when asked', async () => {
        const s = demoSpace('demo;-;x1', { persist: false })
        await s.send('hi'); await s.send({ type: 'richlink', url: 'https://a.b' }); await s.send({ type: 'typing' })
        expect(s.sent).toEqual(['hi', 'https://a.b'])
        expect(saveMessage).not.toHaveBeenCalled()
        const p = demoSpace('demo;-;x1', { persist: true })
        await p.send('yo')
        expect(saveMessage).toHaveBeenCalledWith('demo;-;x1', 'assistant', 'yo')
    })
})
