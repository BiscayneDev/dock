import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { PrivateRouteUnavailable } from '@/lib/spectrum/routing'
import { addToCorpus, egressPolicy, emptyCorpus, findLeak, isEgressTool, isHardBlockTool } from '@/lib/spectrum/egress-guard'
import type { Tool } from '@/lib/llm/types'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const resp = (message: Record<string, unknown>, finish: string) =>
  ({ ok: true, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: finish, message }] }) }) as unknown as Response
const call = (name: string, args: Record<string, unknown> = {}) => ({ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })
const tool = (name: string, data: unknown = { ok: true }, spy = vi.fn()): Tool => ({ name, description: name, inputSchema: { type: 'object', properties: {} }, execute: async () => { spy(); return { success: true, data } } })
const ctx = { tokens: {} } as never
const opts = { gatewayUrl: 'http://gw', apiKey: 'k', model: 'pinned', routing: { providers: ['hopscotch'], attempt_timeout_ms: 15_000, max_tier: 'economy' } }
const MAIL = 'Your reservation at Maison Lune is confirmed for four guests on Friday at 7:30 pm, confirmation code 884213, contact jules@maisonlune.fr'

function run(mode: string, webArgs: Record<string, unknown>, extra: Record<string, string> = {}) {
  vi.stubEnv('DINGHY_PRIVATE_ROUTE', mode)
  vi.stubEnv('DINGHY_PRIVATE_PROVIDERS', 'venice-private')
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v)
  const bodies: Record<string, unknown>[] = []
  const queue = [
    resp({ content: null, tool_calls: [call('gmail_read')] }, 'tool_calls'),
    resp({ content: null, tool_calls: [call('web_search', webArgs)] }, 'tool_calls'),
    resp({ content: 'done' }, 'stop'),
  ]
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return queue.shift()! }))
  const web = vi.fn()
  return { bodies, web, p: chatWithTools([{ role: 'user', content: 'hi' }], opts, [tool('gmail_read', { body: MAIL }), tool('web_search', { hits: 1 }, web)], ctx) }
}

describe('egress guard', () => {
  it('flags verbatim spans, addresses and long numbers, not names or short queries', () => {
    const c = emptyCorpus()
    addToCorpus(c, MAIL)
    expect(findLeak('confirmed for four guests on Friday at 7:30 pm confirmation', c)).toBe('span')
    expect(findLeak('write to jules@maisonlune.fr', c)).toBe('email')
    expect(findLeak('order 884213 status', c)).toBe('digits')
    expect(findLeak('Maison Lune Paris menu', c)).toBeNull()
    expect(findLeak('restaurants near the Marais open late', c)).toBeNull()
    expect(egressPolicy({})).toBe('guard')
    expect(egressPolicy({ DINGHY_EGRESS_POLICY: 'block' })).toBe('block')
    expect(isEgressTool('web_fetch') && !isEgressTool('gmail_read')).toBe(true)
    // sandbox and file tools stay usable even under policy=block
    expect(isHardBlockTool('computer_run')).toBe(false)
    expect(isHardBlockTool('create_file')).toBe(false)
    expect(isHardBlockTool('web_search')).toBe(true)
  })
})

describe('stage B turn behavior', () => {
  it('enforced: private route after a Google tool; clean web search still runs', async () => {
    const { bodies, web, p } = run('on', { query: 'Maison Lune menu and reviews' })
    const r = await p
    expect(r.tainted).toBe(true)
    expect(web).toHaveBeenCalledTimes(1)
    expect(bodies[0].shipyard).toEqual({ providers: ['hopscotch'], attempt_timeout_ms: 15_000, max_tier: 'economy' })
    expect(bodies[1].shipyard).toEqual({ providers: ['venice-private'], attempt_timeout_ms: 15_000, max_tier: 'economy' })
    expect(bodies[2].shipyard).toEqual({ providers: ['venice-private'], attempt_timeout_ms: 15_000, max_tier: 'economy' })
  })
  it('enforced: a search that copies mail text is rejected and never runs', async () => {
    const { web, p } = run('on', { query: 'confirmed for four guests on Friday at 7:30 pm confirmation code 884213' })
    await p
    expect(web).not.toHaveBeenCalled()
  })
  it('policy block stops web tools outright', async () => {
    const { web, p } = run('on', { query: 'anything' }, { DINGHY_EGRESS_POLICY: 'block' })
    await p
    expect(web).not.toHaveBeenCalled()
  })
  it('shadow: nothing changes, leaky search still runs', async () => {
    const { bodies, web, p } = run('shadow', { query: 'confirmed for four guests on Friday at 7:30 pm confirmation code 884213' })
    await p
    expect(web).toHaveBeenCalledTimes(1)
    expect(bodies.every((b) => JSON.stringify(b.shipyard) === JSON.stringify({ providers: ['hopscotch'], attempt_timeout_ms: 15_000, max_tier: 'economy' }))).toBe(true)
  })
  it('fail closed: tagged history with no private provider throws before any call', async () => {
    vi.stubEnv('DINGHY_PRIVATE_ROUTE', 'on')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(chatWithTools([{ role: 'assistant', content: 'x', googleDerived: true }, { role: 'user', content: 'hi' }], opts, [tool('weather')], ctx)).rejects.toThrow(PrivateRouteUnavailable)
    expect(f).not.toHaveBeenCalled()
  })
  it('file and sandbox tools run in a tainted turn even under policy=block', async () => {
    vi.stubEnv('DINGHY_PRIVATE_ROUTE', 'on')
    vi.stubEnv('DINGHY_PRIVATE_PROVIDERS', 'venice-private')
    vi.stubEnv('DINGHY_EGRESS_POLICY', 'block')
    const queue = [
      resp({ content: null, tool_calls: [call('gcal_list_events')] }, 'tool_calls'),
      resp({ content: null, tool_calls: [call('create_file', { title: 'Itinerary' }), call('computer_run', { command: 'python make_itinerary.py' })] }, 'tool_calls'),
      resp({ content: 'here you go' }, 'stop'),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => queue.shift()!))
    const file = vi.fn(), sandbox = vi.fn()
    await chatWithTools([{ role: 'user', content: 'plan my trip' }], opts, [tool('gcal_list_events', { events: ['Flight to Lisbon Mon 9am'] }), tool('create_file', {}, file), tool('computer_run', {}, sandbox)], ctx)
    expect(file).toHaveBeenCalledTimes(1)
    expect(sandbox).toHaveBeenCalledTimes(1)
  })
  it('untainted turns keep the normal route even when enforced', async () => {
    vi.stubEnv('DINGHY_PRIVATE_ROUTE', 'on')
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return resp({ content: 'hey' }, 'stop') }))
    const r = await chatWithTools([{ role: 'user', content: 'hi' }], opts, [tool('weather')], ctx)
    expect(r.tainted).toBe(false)
    expect(bodies[0].shipyard).toEqual({ providers: ['hopscotch'], attempt_timeout_ms: 15_000, max_tier: 'economy' })
  })
})
