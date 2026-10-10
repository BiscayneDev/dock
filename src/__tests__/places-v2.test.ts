import { describe, expect, it } from 'vitest'
import { wantsPlaces } from '@/lib/places/intent'
import { toPlaces } from '@/lib/places/osm'
import { buildPlacesDoc } from '@/lib/places/page'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { vi } from 'vitest'

const now = new Date('2026-10-10T13:43:00Z'), TZ = 'Asia/Singapore', origin = { lat: 1.2857, lon: 103.8486 }

describe('wantsPlaces', () => {
  it('fires on the real ask and common phrasings', () => {
    expect(wantsPlaces("Hey my flights out of Singapore at 1am tonight. I'd like to get some chicken and rice at a nice place. Should be around Parkroyal Pickering (my hotel)")).toBe(true)
    expect(wantsPlaces('where should I eat near the Louvre')).toBe(true)
    expect(wantsPlaces('best ramen in Shibuya')).toBe(true)
    expect(wantsPlaces('good coffee near me')).toBe(true)
  })
  it('does not fire on other asks', () => {
    expect(wantsPlaces('order me pizza from doordash near my house')).toBe(false)
    expect(wantsPlaces('give me a recipe for dinner')).toBe(false)
    expect(wantsPlaces('what time is my flight')).toBe(false)
    expect(wantsPlaces('book a table for 4 at a restaurant near the office')).toBe(false)
  })
})

const els = [
  { type: 'node', id: 1, lat: 1.2862, lon: 103.849, tags: { name: 'KFC', amenity: 'fast_food', brand: 'KFC', cuisine: 'chicken' } },
  { type: 'node', id: 2, lat: 1.287, lon: 103.85, tags: { name: 'Tiong Bahru Hainanese Chicken Rice', amenity: 'restaurant', cuisine: 'chicken_rice' } },
  { type: 'node', id: 3, lat: 1.2872, lon: 103.8505, tags: { name: 'Chin Chin', amenity: 'restaurant', cuisine: 'chinese' } },
]
describe('ranking and page', () => {
  it('chains rank below a real cuisine match and never become the pick', () => {
    const ps = toPlaces(els as never, origin, ['chicken', 'rice'], now, TZ)
    expect(ps.map((p) => p.name)[0]).toBe('Tiong Bahru Hainanese Chicken Rice')
    expect(ps[ps.length - 1]!.name).toBe('KFC')
    const doc = buildPlacesDoc({ places: ps, what: 'chicken rice', anchor: 'x', tz: TZ, now })
    expect(doc.body).toContain('> Pick: Tiong Bahru')
  })
  it('says once, at the top, when open-now is unknown for all', () => {
    const doc = buildPlacesDoc({ places: toPlaces(els as never, origin, ['chicken'], now, TZ), what: 'chicken rice', anchor: 'x', tz: TZ, now })
    expect(doc.allUnknown).toBe(true)
    expect(doc.body.startsWith(':::heads-up')).toBe(true)
    expect(doc.body).toContain("can't tell you what is open right now")
  })
  it('no top note when some hours are known', () => {
    const withHours = [...els, { type: 'node', id: 4, lat: 1.2871, lon: 103.8501, tags: { name: 'Open Place', amenity: 'restaurant', cuisine: 'chicken_rice', opening_hours: 'Mo-Su 10:00-23:59' } }]
    expect(buildPlacesDoc({ places: toPlaces(withHours as never, origin, ['chicken'], now, TZ), what: 'chicken rice', anchor: 'x', tz: TZ, now }).allUnknown).toBe(false)
  })
})

describe('forceTool', () => {
  it('forces the tool on the first call only', async () => {
    const bodies: Record<string, unknown>[] = []
    const queue = [
      { ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'find_places', arguments: '{}' } }] } }] }) },
      { ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }) },
    ]
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return queue.shift()! }))
    const tool = { name: 'find_places', description: 'd', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ success: true, data: {} }) }
    await chatWithTools([{ role: 'user', content: 'x' }], { gatewayUrl: 'http://gw', apiKey: 'k', model: 'm', forceTool: 'find_places' }, [tool as never], { tokens: {} } as never)
    vi.unstubAllGlobals()
    expect(bodies[0]!.tool_choice).toEqual({ type: 'function', function: { name: 'find_places' } })
    expect(bodies[1]!.tool_choice).toBeUndefined()
  })
})

describe('forceTool on a tainted turn under policy=block', () => {
  it('is not forced (the call would be blocked)', async () => {
    vi.stubEnv('DINGHY_EGRESS_POLICY', 'block')
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return { ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }) } }))
    const tool = { name: 'find_places', description: 'd', inputSchema: { type: 'object', properties: {} }, execute: async () => ({ success: true, data: {} }) }
    await chatWithTools([{ role: 'assistant', content: 'x', googleDerived: true }, { role: 'user', content: 'x' }], { gatewayUrl: 'http://gw', apiKey: 'k', model: 'm', forceTool: 'find_places' }, [tool as never], { tokens: {} } as never)
    vi.unstubAllGlobals(); vi.unstubAllEnvs()
    expect(bodies[0]!.tool_choice).toBeUndefined()
  })
})
