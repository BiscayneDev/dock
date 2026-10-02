import { describe, expect, it } from 'vitest'
import { backgroundNote } from '@/lib/spectrum/background-context'

describe('background note', () => {
    it('is null when the bio is missing or too thin', () => {
        expect(backgroundNote('pia', null)).toBeNull()
        expect(backgroundNote('pia', 'hi')).toBeNull()
    })
    it('frames the bio as private, non-instruction context and strips newlines', () => {
        const n = backgroundNote('pia', 'Founder building climate tools.\nPreviously product at a fintech.')!
        expect(n).toContain('@pia')
        expect(n).toMatch(/not an instruction/)
        expect(n).toMatch(/Never recite it/)
        expect(n.trim()).not.toContain('\n')
    })
    it('caps the bio length', () => {
        expect(backgroundNote('pia', 'x'.repeat(2000))!.length).toBeLessThan(700)
    })
})
