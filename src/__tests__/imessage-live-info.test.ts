import { describe, it, expect, vi, afterEach } from 'vitest'
import { weather, describeWeatherCode } from '@/lib/tools/weather'
import { webSearch } from '@/lib/tools/web'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (v: string) => v }))

const ctx = { userId: '', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York', tokens: {} }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('weather tool', () => {
  it('geocodes, then returns current conditions and forecast', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) {
        return jsonResponse({ results: [{ name: 'Miami', admin1: 'Florida', country: 'United States', latitude: 25.77, longitude: -80.19 }] })
      }
      return jsonResponse({
        timezone: 'America/New_York',
        current: { time: '2026-09-23T13:00', temperature_2m: 88.4, apparent_temperature: 97.2, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 9.6 },
        daily: { time: ['2026-09-23'], weather_code: [95], temperature_2m_max: [90.1], temperature_2m_min: [79.6], precipitation_probability_max: [60] },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await weather.execute({ location: 'Miami' }, ctx)
    expect(r.success).toBe(true)
    const d = r.data as { place: string; now: { temp: number; conditions: string }; forecast: { conditions: string; rain_chance_pct: number }[] }
    expect(d.place).toBe('Miami, Florida, United States')
    expect(d.now.temp).toBe(88)
    expect(d.now.conditions).toBe('partly cloudy')
    expect(d.forecast[0]).toMatchObject({ conditions: 'thunderstorms', rain_chance_pct: 60 })
    expect(String(fetchMock.mock.calls[1][0])).toContain('temperature_unit=fahrenheit')
  })

  it('uses the state hint to pick the right place', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) {
        expect(url).toContain('name=Portland')
        return jsonResponse({ results: [
          { name: 'Portland', admin1: 'Oregon', country: 'United States', latitude: 45.5, longitude: -122.7 },
          { name: 'Portland', admin1: 'Maine', country: 'United States', latitude: 43.7, longitude: -70.3 },
        ] })
      }
      expect(url).toContain('latitude=43.7')
      return jsonResponse({ current: { time: 't', temperature_2m: 60, apparent_temperature: 60, relative_humidity_2m: 50, weather_code: 0, wind_speed_10m: 3 }, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_probability_max: [] } })
    }))
    const r = await weather.execute({ location: 'Portland, Maine' }, ctx)
    expect((r.data as { place: string }).place).toBe('Portland, Maine, United States')
  })

  it('reports unknown places and missing input without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({})))
    expect((await weather.execute({ location: 'Nowhereville' }, ctx)).success).toBe(false)
    expect((await weather.execute({}, ctx)).success).toBe(false)
    expect(describeWeatherCode(999)).toBe('unknown')
  })
})

describe('web_search tool', () => {
  it('is inert without a key', async () => {
    vi.stubEnv('TAVILY_API_KEY', '')
    const r = await webSearch.execute({ query: 'dolphins score' }, ctx)
    expect(r).toEqual({ success: false, error: 'Web search is not configured' })
  })

  it('returns the answer and results when configured', async () => {
    vi.stubEnv('TAVILY_API_KEY', 'test-key')
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ answer: 'Dolphins won 24-17.', results: [{ title: 't', url: 'https://x.test', content: 'c' }] })))
    const r = await webSearch.execute({ query: 'dolphins score' }, ctx)
    expect(r.success).toBe(true)
    expect((r.data as { answer: string }).answer).toBe('Dolphins won 24-17.')
  })
})

describe('live info wiring', () => {
  it('every chat gets weather; web_search only with a key', async () => {
    const { liveInfoTools, guestCapabilities, toolsFor } = await import('@/lib/spectrum/imessage-tools')
    vi.stubEnv('TAVILY_API_KEY', '')
    expect(liveInfoTools().map((t) => t.name)).toEqual(['weather'])
    expect(guestCapabilities()).toMatchObject({ google: false, wallet: false, files: false, live: true, search: false })
    vi.stubEnv('TAVILY_API_KEY', 'k')
    expect(liveInfoTools().map((t) => t.name)).toEqual(['weather', 'web_search'])
    // A bound user with nothing connected still gets live info, and no account tools.
    expect(toolsFor(ctx).map((t) => t.name)).toEqual(['weather', 'web_search'])
  })

  it('prompt names the tools that are actually offered', () => {
    const withSearch = buildSystemPrompt([], false, { google: false, wallet: false, live: true, search: true })
    expect(withSearch).toContain('call the weather tool')
    expect(withSearch).toContain('call web_search')
    const noSearch = buildSystemPrompt([], false, { google: false, wallet: false, live: true, search: false })
    expect(noSearch).toContain("can't browse the web yet")
    expect(noSearch).not.toContain('call web_search')
    expect(buildSystemPrompt([], false, false)).not.toContain('weather tool')
  })
})
