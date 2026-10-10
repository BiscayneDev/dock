import { describe, expect, it } from 'vitest'
import { openStatus } from '@/lib/places/hours'
import { keywords, matchesWhat, toPlaces, walkMinutes } from '@/lib/places/osm'
import { buildPlacesDoc } from '@/lib/places/page'
import { renderHtml, splitBlocks, flattenBlocks } from '@/lib/files/render'
import { isEgressTool } from '@/lib/spectrum/egress-guard'

// Sat 10 Oct 2026 21:36 Singapore = 13:36 UTC
const sgt = new Date('2026-10-10T13:36:00Z')
const TZ = 'Asia/Singapore'

describe('openStatus', () => {
  it('open now with closing time', () => { expect(openStatus('Mo-Su 10:00-23:59', sgt, TZ).text).toBe('Open now, until 23:59'); expect(openStatus('Mo-Su 10:00-22:00', new Date('2026-10-10T08:00:00Z'), TZ).text).toBe('Open now, until 22:00') })
  it('flags closing soon within an hour', () => { expect(openStatus('Mo-Su 10:00-22:00', new Date('2026-10-10T13:30:00Z'), TZ).text).toContain('closing soon') })
  it('closed, with the next opening time', () => { expect(openStatus('Mo-Su 07:00-15:00', sgt, TZ)).toEqual({ state: 'closed', text: 'Closed, opens tomorrow 07:00' }) })
  it('later rule overrides earlier (Sa off)', () => { expect(openStatus('Mo-Su 10:00-22:00; Sa off', sgt, TZ).state).toBe('closed') })
  it('split shifts', () => { expect(openStatus('Mo-Su 11:00-14:00,17:00-22:00', sgt, TZ).state).toBe('open'); expect(openStatus('Mo-Su 11:00-14:00,17:00-20:00', sgt, TZ)).toEqual({ state: 'closed', text: 'Closed, opens tomorrow 11:00' }) })
  it('overnight ranges spill into the next day', () => { expect(openStatus('Fr-Sa 18:00-02:00', new Date('2026-10-10T17:30:00Z'), TZ)).toMatchObject({ state: 'open' }); expect(openStatus('Sa 18:00-02:00', new Date('2026-10-10T17:30:00Z'), TZ).state).toBe('open'); expect(openStatus('Fr 18:00-02:00', new Date('2026-10-10T17:30:00Z'), TZ).state).toBe('closed') })
  it('overnight close is not flagged closing soon hours early', () => { expect(openStatus('Mo-Su 17:00-06:00', sgt, TZ).text).toBe('Open now, until 06:00') })
  it('24/7', () => { expect(openStatus('24/7', sgt, TZ).state).toBe('open') })
  it('never guesses: holidays, missing, junk and bad zones are unknown', () => {
    for (const h of ['Mo-Su 10:00-22:00; PH off', undefined, 'by appointment', 'sunrise-sunset']) expect(openStatus(h, sgt, TZ).state).toBe('unknown')
    expect(openStatus('Mo-Su 10:00-22:00', sgt, 'Not/AZone').state).toBe('unknown')
  })
})

describe('places', () => {
  const origin = { lat: 1.2857, lon: 103.8486 }
  const els = [
    { type: 'node', id: 1, lat: 1.2862, lon: 103.8490, tags: { name: 'Chin Chin Eating House', cuisine: 'chicken_rice', opening_hours: 'Mo-Su 10:00-22:00', 'addr:street': 'Purvis Street', 'addr:housenumber': '19' } },
    { type: 'node', id: 2, lat: 1.2900, lon: 103.8500, tags: { name: 'Pizza Place', opening_hours: 'Mo-Su 10:00-22:00' } },
    { type: 'way', id: 3, center: { lat: 1.2870, lon: 103.8480 }, tags: { name: 'Hainanese Delicacy', website: 'javascript:alert(1)' } },
    { type: 'node', id: 4, lat: 1.2, lon: 103.8, tags: { amenity: 'cafe' } },
  ]
  it('keyword matching uses name and cuisine', () => {
    expect(keywords('some good chicken rice')).toEqual(['chicken', 'rice'])
    expect(matchesWhat({ name: 'X', cuisine: 'chicken_rice' }, ['chicken'])).toBe(true)
  })
  it('ranks matches first, drops unnamed, rejects non-http websites, computes walk time', () => {
    const ps = toPlaces(els as never, origin, ['chicken', 'hainanese'], sgt, TZ)
    expect(ps.map((p) => p.name)).toEqual(['Chin Chin Eating House', 'Hainanese Delicacy', 'Pizza Place'])
    expect(ps[0]!.status.state).toBe('open'); expect(ps[1]!.status.state).toBe('unknown')
    expect(ps[1]!.website).toBeUndefined(); expect(ps[0]!.address).toBe('19 Purvis Street')
    expect(walkMinutes(650)).toBe(11)
  })
  it('page renders cards with open badge, map links, honest unknown, no raw html', () => {
    const ps = toPlaces(els as never, origin, ['chicken'], sgt, TZ)
    const doc = buildPlacesDoc({ places: ps, what: 'chicken rice', anchor: 'Parkroyal on Pickering', tz: TZ, now: sgt })
    const html = renderHtml({ title: doc.title, subtitle: doc.subtitle, body: doc.body })
    expect(html).toContain('plc-open'); expect(html).toContain('Open now, until 22:00'); expect(html).toContain('maps.apple.com'); expect(html).toContain('Hours not listed')
    expect(html).toContain('OpenStreetMap'); expect(html).not.toContain('javascript:')
    expect(splitBlocks(doc.body).some((s) => s.kind === 'block' && s.name === 'places')).toBe(true)
    expect(flattenBlocks(doc.body)).toContain('Chin Chin Eating House')
    expect(doc.text).toContain('1. Chin Chin Eating House')
  })
  it('find_places is an egress tool', () => { expect(isEgressTool('find_places')).toBe(true) })
})
