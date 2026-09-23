import { describe, expect, it } from 'vitest'
import { extractInviteCode, generateInviteCode, hashInviteCode, parseInviteCommand } from '@/lib/spectrum/beta-gate'

describe('beta gate helpers', () => {
    it('generates XXXX-XXXX codes without ambiguous characters', () => {
        for (let i = 0; i < 50; i++) {
            const c = generateInviteCode()
            expect(c).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/)
            expect(extractInviteCode(c)).toBe(c)
        }
    })
    it('extracts codes from dashed or bare messages', () => {
        expect(extractInviteCode('my code is abcd-efgh thanks')).toBe('ABCD-EFGH')
        expect(extractInviteCode('ABCDEFGH')).toBe('ABCD-EFGH')
        expect(extractInviteCode('dinghy abcdefgh')).toBe('ABCD-EFGH')
    })
    it('ignores ordinary words and questions', () => {
        expect(extractInviteCode('what is this number')).toBeNull()
        expect(extractInviteCode('hey sweetest person')).toBeNull()
        expect(extractInviteCode('hello')).toBeNull()
    })
    it('hashes case- and dash-insensitively', () => {
        expect(hashInviteCode('abcd-efgh')).toBe(hashInviteCode('ABCDEFGH'))
    })
    it('parses the owner invite command', () => {
        expect(parseInviteCommand('invite')).toBe(1)
        expect(parseInviteCommand('new invite code')).toBe(1)
        expect(parseInviteCommand('invite 5')).toBe(5)
        expect(parseInviteCommand('invite x3')).toBe(3)
        expect(parseInviteCommand('invite 500 uses')).toBe(100)
        expect(parseInviteCommand('can you invite sam to my meeting')).toBeNull()
    })
})
