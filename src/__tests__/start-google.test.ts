import { describe, expect, it } from 'vitest'
import { startGoogleEligible, startGooglePath } from '@/lib/spectrum/start-link'

describe('start page google connect', () => {
  it('needs a live row with a real phone', () => {
    expect(startGoogleEligible({ phone: '+16784680733', status: 'invited' })).toBe(true)
    expect(startGoogleEligible({ phone: null, status: 'invited' })).toBe(false)
    expect(startGoogleEligible({ phone: 'abc', status: 'joined' })).toBe(false)
    expect(startGoogleEligible({ phone: '+16784680733', status: 'banned' })).toBe(false)
    expect(startGoogleEligible(null)).toBe(false)
  })
  it('builds the path', () => expect(startGooglePath('abc')).toBe('/start/abc/google'))
})
