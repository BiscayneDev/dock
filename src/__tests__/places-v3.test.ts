import { describe, expect, it, vi } from 'vitest'
import { anchorConfident, toPlaces, zoneAt } from '@/lib/places/osm'
import { buildPlacesDoc } from '@/lib/places/page'

describe('zoneAt', () => {
  it('derives the zone from the coordinates, not from the user', () => {
    expect(zoneAt(1.2857, 103.8462)).toBe('Asia/Singapore')
    expect(zoneAt(25.76, -80.19)).toBe('America/New_York')
    expect(zoneAt(48.85, 2.35)).toBe('Europe/Paris')
  })
})

describe('anchorConfident', () => {
  it('matches a hotel nickname to its resolved label', () => {
    expect(anchorConfident('Parkroyal on Pickering, Singapore', 'PARKROYAL COLLECTION Pickering, Singapore, Upper Pickering Street, Singapore')).toBe(true)
  })
  it('flags a different place or city', () => {
    expect(anchorConfident('Hilton Garden Inn, Springfield', 'Hilton Hotel, Oak Street, Shelbyville, Illinois')).toBe(false)
  })
})

describe('untrusted timezone and low-confidence anchor', () => {
  const els = [{ type: 'node', id: 2, lat: 1.2862, lon: 103.849, tags: { name: 'Ayam Place', cuisine: 'chicken_rice', opening_hours: 'Mo-Su 00:00-23:59' } }]
  const now = new Date('2026-10-10T13:43:00Z')
  it('never reports open/closed when the zone is untrusted', () => {
    const ps = toPlaces(els as never, { lat: 1.28, lon: 103.84 }, ['chicken'], now, 'UTC', true)
    expect(ps[0]!.status.state).toBe('unknown')
  })
  it('page flags a weak geocode at the top and names what was searched', () => {
    const ps = toPlaces(els as never, { lat: 1.28, lon: 103.84 }, ['chicken'], now, 'Asia/Singapore')
    const doc = buildPlacesDoc({ places: ps, what: 'chicken rice', anchor: 'Hilton Garden Inn', tz: 'Asia/Singapore', now, resolved: 'Hilton Hotel, Shelbyville, Illinois', lowConfidence: true })
    expect(doc.body.startsWith(':::heads-up')).toBe(true)
    expect(doc.body).toContain('I could not match "Hilton Garden Inn" exactly')
    expect(doc.body).toContain('Shelbyville, Illinois')
  })
})

import { cacheKey, looksLikeStreetAddress } from '@/lib/places/osm'
describe('geocode cache privacy', () => {
  it('keys by hash, same for case/spacing, never the text', () => {
    const k = cacheKey('Parkroyal on Pickering, Singapore')
    expect(k).toMatch(/^[0-9a-f]{64}$/)
    expect(cacheKey('  parkroyal ON pickering,   singapore ')).toBe(k)
    expect(k).not.toContain('parkroyal')
  })
  it('street addresses are never cached', () => {
    for (const a of ['1600 Pennsylvania Avenue, Washington', '221B Baker Street London', '12 rue de Rivoli, Paris', '90 NE 2nd St, Miami']) expect(looksLikeStreetAddress(a)).toBe(true)
    for (const a of ['Parkroyal on Pickering, Singapore', 'Louvre Museum Paris', 'Shibuya Station']) expect(looksLikeStreetAddress(a)).toBe(false)
  })
})
