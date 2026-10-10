import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithTools, needsAnswerPage } from '@/lib/spectrum/dinghy'
import type { Tool } from '@/lib/llm/types'
vi.mock('@/lib/data-portability/erasure-state', () => ({ assertAccountActive: vi.fn(async () => {}) }))
const ctx = { userId: 'u', telegramId: 0, telegramChatId: 0, name: 'A', timezone: 'Asia/Singapore', tokens: {} }
const opts = { gatewayUrl: 'https://gateway.test', apiKey: 'test', model: 'test' }
const answer = '1. A - verified option\n2. B - verified option\n3. C - verified option'
function tool(name: string, success = true): Tool { return { name, description: name, inputSchema: {}, execute: vi.fn(async () => ({ success, data: { results: [{ url: 'https://venue.test/menu' }] }, error: success ? undefined : 'unavailable' })) } }
function response(name?: string, reply = 'Done.') { return new Response(JSON.stringify({ choices: [{ finish_reason: name ? 'tool_calls' : 'stop', message: name ? { content: null, tool_calls: [{ id: Math.random().toString(), function: { name, arguments: '{}' } }] } : { content: reply } }] })) }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
describe('research completion headroom', () => {
  it('stops repeated search with time left for page creation and keeps returned evidence', async () => {
    let now = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const bodies: any[] = []
    const search = tool('web_search'), file = tool('create_file'), action = tool('gcal_list')
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body)); now += bodies.length <= 2 ? 25_000 : 10_000
      return bodies.length === 1 ? response('web_search') : bodies.length === 2 ? response('web_search') : bodies.length === 3 ? response('create_file') : response()
    }))
    await chatWithTools([{ role: 'user', content: 'Compare dinner options' }], { ...opts, deadlineAt: 86_000 }, [search, file, action], ctx)
    expect(search.execute).toHaveBeenCalledTimes(2)
    expect(file.execute).toHaveBeenCalledOnce()
    expect(bodies[2].tools.map((t: any) => t.function.name)).toEqual(['create_file', 'gcal_list'])
    expect(JSON.stringify(bodies[2].messages)).toContain('https://venue.test/menu')
    expect(JSON.stringify(bodies[2].messages)).toContain('A search-category URL is not a source')
    expect(bodies).toHaveLength(3)
  })
  it('does not cap two searches when plenty of time remains', async () => {
    const search = tool('web_search'); let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => ++n <= 3 ? response('web_search') : response()))
    await chatWithTools([{ role: 'user', content: 'Research' }], { ...opts, deadlineAt: Date.now() + 100_000 }, [search], ctx)
    expect(search.execute).toHaveBeenCalledTimes(3)
  })
  it('never converts a failed search into verified evidence', async () => {
    const search = tool('web_search', false); const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? response('web_search') : response() }))
    await chatWithTools([{ role: 'user', content: 'Research' }], { ...opts, deadlineAt: Date.now() + 30_000 }, [search], ctx)
    expect(bodies[1].tools[0].function.name).toBe('web_search')
  })
})
describe('post-search gateway rescue', () => {
  it('returns only observed links when the bounded gateway stalls', async () => {
    vi.useFakeTimers()
    const search = tool('web_search'); let n = 0; const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      if (++n === 1) return response('web_search')
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    }))
    const run = chatWithTools([{ role: 'user', content: 'Dinner near my hotel' }], { ...opts, deadlineAt: Date.now() + 50_000 }, [search], ctx)
    await vi.advanceTimersByTimeAsync(25_000)
    const r = await run
    expect(r.reply).toContain('not verified recommendations')
    expect(r.reply).toContain('https://venue.test/menu')
    expect(bodies[1].max_tokens).toBe(1200)
    vi.useRealTimers()
  })
  it('does not turn a deadline after an action into a source-only completion', async () => {
    vi.useFakeTimers()
    const search = tool('web_search'), action = tool('gcal_create'); let n = 0
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (++n === 1) return response('web_search')
      if (n === 2) return response('gcal_create')
      return new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    }))
    const run = chatWithTools([{ role: 'user', content: 'Research and schedule' }], { ...opts, deadlineAt: Date.now() + 50_000 }, [search, action], ctx)
    const expectation = expect(run).rejects.toThrow('turn deadline exceeded')
    await vi.advanceTimersByTimeAsync(50_000)
    await expectation
    vi.useRealTimers()
  })
})
describe('answer page retry', () => {
  it('retries a long list once using the same evidence, then accepts the page result', async () => {
    const file = tool('create_file'); const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? response(undefined, answer) : bodies.length === 2 ? response('create_file') : response() }))
    const r = await chatWithTools([{ role: 'user', content: 'Plan dinner' }], opts, [file], ctx)
    expect(file.execute).toHaveBeenCalledOnce(); expect(r.reply).toBe('Here you go.')
    expect(JSON.stringify(bodies[1].messages)).toContain('no page was made')
  })
  it('does not retry hosting after a failed attempt or start a retry near the deadline', async () => {
    const file = tool('create_file', false); let n = 0
    vi.stubGlobal('fetch', vi.fn(async () => ++n === 1 ? response('create_file') : response(undefined, answer)))
    await chatWithTools([{ role: 'user', content: 'Plan' }], opts, [file], ctx)
    expect(file.execute).toHaveBeenCalledOnce(); expect(n).toBe(2)
    n = 0
    vi.stubGlobal('fetch', vi.fn(async () => { n++; return response(undefined, answer) }))
    await chatWithTools([{ role: 'user', content: 'Plan' }], { ...opts, deadlineAt: Date.now() + 10_000 }, [file], ctx)
    expect(n).toBe(1)
  })
  it('keeps short answers in chat', () => { expect(needsAnswerPage('The restaurant opens at 6.')).toBe(false); expect(needsAnswerPage(answer)).toBe(true) })
})
