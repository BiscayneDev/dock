import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatWithTools } from '@/lib/spectrum/dinghy'
afterEach(() => vi.unstubAllGlobals())
describe('exhausted tool loop', () => {
  it('keeps tool definitions while disabling new calls for synthesis', async () => {
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, opts: RequestInit) => {
      const body = JSON.parse(opts.body as string)
      bodies.push(body)
      const n = bodies.length
      return new Response(JSON.stringify({ choices: [{ finish_reason: n <= 8 ? 'tool_calls' : 'stop', message: n <= 8 ? { content: null, tool_calls: [{ id: `call-${n}`, type: 'function', function: { name: 'read', arguments: '{}' } }] } : { content: 'Finished result.' } }] }), { status: 200 })
    }))
    const execute = vi.fn(async () => ({ success: true, data: { text: 'result' } }))
    const result = await chatWithTools([{ role: 'user', content: 'Research this' }], { gatewayUrl: 'https://gateway.test', apiKey: 'test', model: 'test' }, [{ name: 'read', description: 'Read', inputSchema: { type: 'object', properties: {} }, execute }], { userId: 'user-a', telegramId: 0, telegramChatId: 0, name: 'Ada', timezone: 'America/New_York', tokens: {} })
    expect(result.reply).toBe('Finished result.')
    expect(execute).toHaveBeenCalledTimes(8)
    expect(bodies[8]).toMatchObject({ tool_choice: 'none', tools: [{ type: 'function', function: { name: 'read' } }] })
  })
})
