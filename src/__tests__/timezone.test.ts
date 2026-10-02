import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseTimezoneIntent, validIanaTimezone, resolvePlaceTimezone, resolvePinTimezone, timezoneAck } from '@/lib/spectrum/timezone'

afterEach(() => vi.unstubAllGlobals())

describe('explicit timezone changes', () => {
  it('recognizes only direct, full-message location and timezone requests', () => {
    expect(parseTimezoneIntent("I'm in Paris")).toBe('Paris')
    expect(parseTimezoneIntent('I am currently in London.')).toBe('London')
    expect(parseTimezoneIntent('set my timezone to Europe/Paris')).toBe('Europe/Paris')
    expect(parseTimezoneIntent('please change my time zone to Miami, Florida')).toBe('Miami, Florida')
    expect(parseTimezoneIntent("Nope. I'm back in nyc. Flew back yesterday.")).toBe('nyc')
    expect(parseTimezoneIntent("I'm going to be in Paris.")).toBeNull()
    expect(parseTimezoneIntent('I was in Paris')).toBeNull()
    expect(parseTimezoneIntent('Sam said "I am in Paris"')).toBeNull()
  })
  it('validates direct IANA zones, not abbreviations', () => {
    expect(validIanaTimezone('Europe/Paris')).toBe('Europe/Paris')
    expect(validIanaTimezone('EST')).toBeNull()
    expect(validIanaTimezone('Not/AZone')).toBeNull()
  })
  it('asks on distinct zones, including two Parises', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [
      { name: 'Paris', country: 'France', timezone: 'Europe/Paris' },
      { name: 'Paris', country: 'United States', admin1: 'Texas', timezone: 'America/Chicago' },
    ] }) })))
    expect((await resolvePlaceTimezone('Paris')).kind).toBe('ambiguous')
    expect(await resolvePlaceTimezone('Paris, France')).toEqual({ kind: 'one', choice: { zone: 'Europe/Paris', label: 'Paris, France' } })
    expect((await resolvePlaceTimezone('Paris, Spain')).kind).toBe('none')
  })
  it('does not guess on failure or a non-IANA forecast zone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    expect(await resolvePlaceTimezone('Paris')).toEqual({ kind: 'none' })
    expect(await resolvePinTimezone({ lat: 48.8566, lon: 2.3522 })).toBeNull()
  })
  it('uses the exact coordinate lookup zone and confirms eight local', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ timezone: 'Europe/Paris' }) })))
    expect(await resolvePinTimezone({ lat: 48.8566, lon: 2.3522 })).toBe('Europe/Paris')
    expect(timezoneAck({ zone: 'Europe/Paris', label: 'Paris' })).toContain('8am there')
  })
})
