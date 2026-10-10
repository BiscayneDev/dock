import { afterEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }))
import { cardWeather, geocode, placeName } from '@/lib/weather/brief-weather'

afterEach(() => { vi.unstubAllGlobals(); rpc.mockReset() })
const ok = (body: unknown) => ({ ok: true, json: async () => body })

describe('briefing location privacy', () => {
  it('never geocodes a street-looking home place', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    expect(await geocode('123 Main Street, Miami')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
  it('still geocodes a city name', async () => {
    const f = vi.fn(async () => ok({ results: [{ name: 'Miami', admin1: 'Florida', country: 'United States', latitude: 25.77, longitude: -80.19 }] }))
    vi.stubGlobal('fetch', f)
    expect(await geocode('Miami, FL')).toMatchObject({ label: 'Miami' })
  })
  it('weather forecast gets coordinates rounded to ~100 m', async () => {
    const f = vi.fn(async () => ok({}))
    vi.stubGlobal('fetch', f)
    await cardWeather(25.761681, -80.191788, 'Miami').catch(() => null)
    const url = String((f.mock.calls[0] as unknown as [string])[0])
    expect(url).toContain('latitude=25.762'); expect(url).toContain('longitude=-80.192'); expect(url).not.toContain('25.761681')
  })
  it('reverse geocode rounds, goes through the shared budget, and sends nothing without it', async () => {
    rpc.mockResolvedValue({ data: 0, error: null })
    const f = vi.fn(async () => ok({ address: { city: 'Miami' } }))
    vi.stubGlobal('fetch', f)
    expect(await placeName(25.761681, -80.191788)).toBe('Miami')
    expect(rpc).toHaveBeenCalledWith('claim_places_slot', expect.objectContaining({ p_host: 'nominatim.openstreetmap.org' }))
    const url = String((f.mock.calls[0] as unknown as [string])[0])
    expect(url).toContain('lat=25.762'); expect(url).not.toContain('25.761681')
    f.mockClear(); rpc.mockResolvedValue({ data: -1, error: null })
    expect(await placeName(25.761681, -80.191788)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
