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

import { normalizePhone, maskPhone } from '@/lib/waitlist'
import { buildWaitlistConfirmation, firstName } from '@/lib/email/waitlist-confirmation'

describe('waitlist phone', () => {
  it('normalizes US and international numbers to E.164', () => {
    expect(normalizePhone('(415) 555-0123')).toBe('+14155550123')
    expect(normalizePhone('1 415 555 0123')).toBe('+14155550123')
    expect(normalizePhone('+44 20 7946 0958')).toBe('+442079460958')
    expect(normalizePhone('555-0123')).toBeNull()
    expect(normalizePhone('call me')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
  it('masks for display', () => {
    expect(maskPhone('+14155550123')).toBe('(•••) •••-0123')
    expect(maskPhone('+442079460958')).toBe('•••0958')
  })
})

describe('waitlist confirmation email', () => {
  it('uses first name and masked phone, never the full number', () => {
    const { subject, text, html } = buildWaitlistConfirmation({ email: 'a@b.co', name: 'Ada Lovelace', phone: '+14155550123' })
    expect(subject).toContain('waitlist')
    expect(text).toContain('hey ada')
    expect(text).toContain('0123')
    expect(text).not.toContain('4155550123')
    expect(html).not.toContain('4155550123')
    expect(firstName('  Grace Hopper ')).toBe('Grace')
  })
  it('escapes names in html', () => {
    const { html } = buildWaitlistConfirmation({ email: 'a@b.co', name: '<b>x</b>', phone: '+14155550123' })
    expect(html).not.toContain('<b>x')
  })
})
