import { describe, expect, it } from 'vitest'
import { GOOGLE_CONNECT_ASK } from '@/lib/spectrum/connect-lines'

describe('early Google connect ask', () => {
    it('names what it unlocks, is one tap, and stays plain text in Instinct voice', () => {
        expect(GOOGLE_CONNECT_ASK).toMatch(/calendar/i)
        expect(GOOGLE_CONNECT_ASK).toMatch(/inbox/i)
        expect(GOOGLE_CONNECT_ASK).toMatch(/8/)
        expect(GOOGLE_CONNECT_ASK).toMatch(/one tap/i)
        expect(GOOGLE_CONNECT_ASK).not.toMatch(/[*_`#—]|can't|cannot/i)
    })
})
