import { describe, it, expect } from 'vitest'
import { normalizeEmail, normalizeName, normalizeTwitterHandle } from '@/lib/waitlist'

describe('waitlist validation', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  Foo@Bar.com ')).toBe('foo@bar.com')
    expect(normalizeEmail('nope')).toBeNull()
  })
  it('requires a name up to 80 chars', () => {
    expect(normalizeName('  Ada   Lovelace ')).toBe('Ada Lovelace')
    expect(normalizeName('   ')).toBeNull()
    expect(normalizeName(undefined)).toBeNull()
    expect(normalizeName('x'.repeat(81))).toBeNull()
  })
  it('accepts handle forms and treats blank as optional', () => {
    expect(normalizeTwitterHandle('@halsey_h')).toBe('halsey_h')
    expect(normalizeTwitterHandle('halsey_h')).toBe('halsey_h')
    expect(normalizeTwitterHandle('https://x.com/halsey_h?s=21')).toBe('halsey_h')
    expect(normalizeTwitterHandle('twitter.com/halsey_h')).toBe('halsey_h')
    expect(normalizeTwitterHandle('')).toBe('')
    expect(normalizeTwitterHandle(undefined)).toBe('')
    expect(normalizeTwitterHandle('bad handle!')).toBeNull()
    expect(normalizeTwitterHandle('a'.repeat(16))).toBeNull()
  })
})
