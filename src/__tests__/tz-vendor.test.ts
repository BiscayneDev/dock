import { createRequire } from 'module'
import { describe, expect, it } from 'vitest'
import tz from '@/lib/places/vendor/tz-lookup'

describe('vendored tz-lookup', () => {
  it('resolves zones from coordinates', () => {
    expect(tz(1.2857, 103.8462)).toBe('Asia/Singapore')
    expect(tz(25.76, -80.19)).toBe('America/New_York')
    expect(tz(48.85, 2.35)).toBe('Europe/Paris')
    expect(tz(35.68, 139.69)).toBe('Asia/Tokyo')
    expect(tz(-33.87, 151.21)).toBe('Australia/Sydney')
    expect(tz(37.77, -122.42)).toBe('America/Los_Angeles')
  })
  it('throws on invalid coordinates (callers treat that as unknown)', () => {
    expect(() => tz(200, 0)).toThrow()
  })
})
