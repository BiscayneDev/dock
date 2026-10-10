import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), upsert: async () => ({}), delete: () => ({ lt: async () => ({}) }) }) }) }))

import { fileToolsFor } from '@/lib/files/tool'
import { BudgetUnavailable, endpoints, geocode, geocodeCached, geocoderIsPrivate, nearbyEateries, politely } from '@/lib/places/osm'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rpc.mockReset() })

describe('shared budget', () => {
  it('claims a slot from the database and waits the returned time', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    await politely('nominatim.openstreetmap.org')
    expect(rpc).toHaveBeenCalledWith('claim_places_slot', { p_host: 'nominatim.openstreetmap.org', p_gap_ms: 1000, p_max_wait_ms: 4000 })
  })
  it('fails closed: refused claim, rpc error or thrown rpc never sends', async () => {
    for (const r of [{ data: -1, error: null }, { data: null, error: { message: 'x' } }]) {
      rpc.mockResolvedValue(r)
      await expect(politely('h')).rejects.toBeInstanceOf(BudgetUnavailable)
    }
    rpc.mockRejectedValue(new Error('db down'))
    await expect(politely('h')).rejects.toBeInstanceOf(BudgetUnavailable)
  })
  it('geocode sends no request when the budget is unavailable', async () => {
    rpc.mockResolvedValue({ data: -1, error: null })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await expect(geocode('Louvre Museum Paris')).rejects.toBeInstanceOf(BudgetUnavailable)
    expect(f).not.toHaveBeenCalled()
  })
  it('overpass also needs the budget and never bursts to the mirror when refused', async () => {
    rpc.mockResolvedValue({ data: -1, error: null })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await expect(nearbyEateries({ lat: 1, lon: 1 }, 500)).rejects.toBeInstanceOf(BudgetUnavailable)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('configurable endpoints', () => {
  it('defaults to the public servers and honours env overrides', () => {
    expect(endpoints().nominatim).toBe('https://nominatim.openstreetmap.org')
    vi.stubEnv('PLACES_NOMINATIM_URL', 'https://geo.internal.example/')
    vi.stubEnv('PLACES_OVERPASS_URL', 'https://op.internal.example/api/interpreter')
    expect(endpoints().nominatim).toBe('https://geo.internal.example')
    expect(endpoints().overpass).toBe('https://op.internal.example/api/interpreter')
  })
  it('a self-hosted geocoder skips the shared budget and uses the configured URL', async () => {
    vi.stubEnv('PLACES_NOMINATIM_URL', 'https://geo.internal.example')
    const f = vi.fn(async () => ({ ok: true, json: async () => [{ lat: '1.5', lon: '103.5', display_name: 'X' }] }))
    vi.stubGlobal('fetch', f)
    const r = await geocodeCached('1 Main Street, Somewhere')
    expect(r).toMatchObject({ lat: 1.5 })
    expect(rpc).not.toHaveBeenCalled()
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain('https://geo.internal.example/search')
  })
  it('geocoderIsPrivate needs the explicit flag AND both geocoders off the public hosts', () => {
    expect(geocoderIsPrivate()).toBe(false)
    vi.stubEnv('PLACES_NOMINATIM_URL', 'https://geo.internal.example')
    expect(geocoderIsPrivate()).toBe(false) // photon still public
    vi.stubEnv('PLACES_PHOTON_URL', 'https://photon.internal.example')
    expect(geocoderIsPrivate()).toBe(false) // no explicit flag
    vi.stubEnv('PLACES_GEOCODER_PRIVATE', '1')
    expect(geocoderIsPrivate()).toBe(true)
    vi.stubEnv('PLACES_PHOTON_URL', 'https://photon.komoot.io')
    expect(geocoderIsPrivate()).toBe(false) // a public host back in the chain
  })
  it('an address query never reaches a public geocoder even if called directly', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    expect(await geocode('1600 Pennsylvania Avenue, Washington')).toBeNull()
    expect(f).not.toHaveBeenCalled()
    // nominatim private, photon public: still no public call for the address
    vi.stubEnv('PLACES_NOMINATIM_URL', 'https://geo.internal.example')
    const g = vi.fn(async () => ({ ok: true, json: async () => [] })); vi.stubGlobal('fetch', g)
    await geocode('1600 Pennsylvania Avenue, Washington')
    expect(g.mock.calls.every((c) => !String((c as unknown as [string])[0]).includes('photon.komoot.io'))).toBe(true)
  })
})

describe('find_places privacy and budget behaviour', () => {
  const tool = () => fileToolsFor().tools.find((t) => t.name === 'find_places')!
  const ctx = { userId: 'u1', tokens: {} } as never
  it('never sends a street address to a public geocoder; asks for a landmark', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const r = await tool().execute({ anchor: '1600 Pennsylvania Avenue, Washington', what: 'pizza' }, ctx)
    expect(r.success).toBe(false)
    expect(JSON.stringify(r)).toContain('landmark')
    expect(f).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled()
  })
  it('returns a plain "could not look up" error, with no request sent, when the budget is unavailable', async () => {
    rpc.mockResolvedValue({ data: -1, error: null })
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    const r = await tool().execute({ anchor: 'Louvre Museum Paris', what: 'coffee' }, ctx)
    expect(r.success).toBe(false); expect(JSON.stringify(r)).toContain("couldn't look that up right now")
    expect(f).not.toHaveBeenCalled()
  })
})

import { roundCoord } from '@/lib/places/pin'
describe('shared pin rounding', () => {
  it('rounds to 3 decimals (~110 m)', () => {
    expect(roundCoord(25.761681)).toBe(25.762)
    expect(roundCoord(-80.191788)).toBe(-80.192)
  })
  it('the pin path sends rounded coordinates to Overpass and never geocodes the address', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    const sent: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: { body?: string }) => { sent.push(String(_u) + ' ' + (init?.body ?? '')); return { ok: true, json: async () => ({ elements: [] }) } }))
    vi.doMock('@/lib/places/pin', async (orig) => ({ ...(await orig<typeof import('@/lib/places/pin')>()), freshPin: async () => ({ lat: 25.761681, lon: -80.191788, label: null }) }))
    vi.resetModules()
    const { fileToolsFor: fresh } = await import('@/lib/files/tool')
    const r = await fresh().tools.find((t) => t.name === 'find_places')!.execute({ anchor: '1 Main Street, Miami', what: 'pizza' }, { userId: 'u', tokens: {} } as never)
    vi.doUnmock('@/lib/places/pin')
    expect(sent.some((x) => x.includes('nominatim') || x.includes('photon'))).toBe(false)
    expect(sent.join(' ')).toContain(encodeURIComponent('25.762'))
    expect(sent.join(' ')).not.toContain('25.761681')
    expect(r.success).toBe(false) // no venues in the stub; the point is what was sent
  })
})

import { readFileSync } from 'fs'
describe('claim_places_slot validation (migration text)', () => {
  const sql = readFileSync('supabase/migrations/071_place_geocode_cache.sql', 'utf8')
  it('rejects null and out-of-range arguments before touching the table', () => {
    expect(sql).toContain("p_gap_ms is null or p_gap_ms < 100 or p_gap_ms > 10000")
    expect(sql).toContain("p_max_wait_ms is null or p_max_wait_ms < 0 or p_max_wait_ms > 5000")
    expect(sql.indexOf('raise exception')).toBeLessThan(sql.indexOf('insert into public.places_rate'))
  })
})
