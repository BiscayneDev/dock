import { readFileSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withinTurn, TurnDeadlineExceeded } from '@/lib/spectrum/turn-budget'
import { chatWithTools } from '@/lib/spectrum/dinghy'
import { runStageRecorder } from '@/lib/spectrum/run-stage'

const ctx = { userId: 'u', telegramId: 0, telegramChatId: 0, name: 'A', timezone: 'UTC', tokens: {} }
const opts = { gatewayUrl: 'https://gateway.test', apiKey: 'test', model: 'test' }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('turn budget', () => {
  it('does not start work after the deadline', async () => {
    const work = vi.fn()
    await expect(withinTurn(Date.now() - 1, work)).rejects.toBeInstanceOf(TurnDeadlineExceeded)
    expect(work).not.toHaveBeenCalled()
  })
  it('aborts an in-flight gateway and returns before an indefinite wait', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const run = withinTurn(Date.now() + 100, async (s) => {
      signal = s
      return new Promise<string>(() => {})
    })
    const failure = expect(run).rejects.toBeInstanceOf(TurnDeadlineExceeded)
    await vi.advanceTimersByTimeAsync(100)
    await failure
    expect(signal?.aborted).toBe(true)
  })
  it('stops a tool wait at the turn deadline and starts no later calls', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [
      { id: '1', function: { name: 'read', arguments: '{}' } },
      { id: '2', function: { name: 'read', arguments: '{}' } },
    ] } }] })))
    vi.stubGlobal('fetch', fetchMock)
    const execute = vi.fn(() => new Promise<{ success: boolean }>(() => {}))
    const run = chatWithTools([{ role: 'user', content: 'research' }], { ...opts, deadlineAt: Date.now() + 100 }, [{ name: 'read', description: 'read', inputSchema: {}, execute }], ctx)
    const failure = expect(run).rejects.toBeInstanceOf(TurnDeadlineExceeded)
    await vi.advanceTimersByTimeAsync(100)
    await failure
    expect(execute).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('returns a normal result within the budget', async () => {
    await expect(withinTurn(Date.now() + 1000, async () => 'done')).resolves.toBe('done')
  })
})

describe('metadata run records', () => {
  it('persists stage identifiers without task content or raw errors', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-key')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const record = runStageRecorder('chat-1', 'message-1')
    await record('tool', 'web_search')
    await record('deadline')
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(first).toMatchObject({ chat_guid: 'chat-1', message_id: 'message-1', stage: 'tool', detail: 'web_search' })
    expect(first.run_id).toBe(second.run_id)
    expect(Object.keys(first).sort()).toEqual(['chat_guid', 'detail', 'message_id', 'run_id', 'stage'])
  })
  it('does not break the reply when storage is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'private-key')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('storage down') }))
    await expect(runStageRecorder('chat-1')('context')).resolves.toBeUndefined()
  })
})

describe('webhook deadline wiring', () => {
  it('reserves reply headroom and persists an honest deadline notice', () => {
    const handler = readFileSync('src/lib/spectrum/handler.ts', 'utf8')
    expect(handler).toContain('const deadlineAt = turnStartedAt + TURN_WORK_MS')
    expect(handler).toContain('deadlineAt, onStage,')
    expect(handler).toContain("await onStage('deadline')")
    expect(handler).toContain("await sendText(space, chatGuid, 'error_notice', TURN_DEADLINE_REPLY)")
    expect(handler).toContain("await saveMessage(chatGuid, 'assistant', TURN_DEADLINE_REPLY)")
  })
})
