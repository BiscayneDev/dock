import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMResponse, Tool, UserContext } from './types'
import type { ToolTrace } from './agent-loop'

// Drive the loop with a scripted provider and a controllable CONFIRM_TOOLS set.
const { responses, mockChat } = vi.hoisted(() => {
  const responses: LLMResponse[] = []
  const mockChat = vi.fn()
  return { responses, mockChat }
})

vi.mock('@/lib/llm/index', () => ({ getLLMProvider: () => ({ chat: mockChat }) }))
vi.mock('@/lib/orchestrator/confirmation', () => ({ CONFIRM_TOOLS: new Set(['danger_tool']) }))

import { runAgentLoop } from './agent-loop'

const ctx: UserContext = {
  userId: 'u1',
  telegramId: 1,
  telegramChatId: 1,
  name: 't',
  timezone: 'UTC',
  tokens: {},
}

function tool(name: string, execute: Tool['execute']): Tool {
  return { name, description: name, inputSchema: { type: 'object', properties: {} }, execute }
}

const END: LLMResponse['stopReason'] = 'end_turn'
const USE: LLMResponse['stopReason'] = 'tool_use'

beforeEach(() => {
  responses.length = 0
  mockChat.mockReset()
  // Default: serve scripted responses, then a terminal fallback.
  mockChat.mockImplementation(async () => responses.shift() ?? { content: 'fallback', toolCalls: [], stopReason: END })
})

describe('runAgentLoop', () => {
  it('returns the assistant text when the model ends its turn', async () => {
    responses.push({ content: 'hello', toolCalls: [], stopReason: END })
    const result = await runAgentLoop('sys', [{ role: 'user', content: 'hi' }], [], ctx)
    expect(result).toBe('hello')
  })

  it('executes a tool then continues to the final answer', async () => {
    const echo = vi.fn(async (input: unknown) => ({ success: true, data: input }))
    responses.push(
      { content: null, toolCalls: [{ id: '1', name: 'echo', input: { x: 1 } }], stopReason: USE },
      { content: 'done', toolCalls: [], stopReason: END }
    )

    const result = await runAgentLoop('sys', [{ role: 'user', content: 'go' }], [tool('echo', echo)], ctx)

    expect(result).toBe('done')
    expect(echo).toHaveBeenCalledTimes(1)
    expect(echo).toHaveBeenCalledWith({ x: 1 }, ctx)
  })

  it('skips a confirmed tool when the user declines', async () => {
    const danger = vi.fn(async () => ({ success: true }))
    responses.push(
      { content: null, toolCalls: [{ id: '1', name: 'danger_tool', input: {} }], stopReason: USE },
      { content: 'ok', toolCalls: [], stopReason: END }
    )

    const onConfirm = vi.fn(async () => false)
    const result = await runAgentLoop(
      'sys',
      [{ role: 'user', content: 'do it' }],
      [tool('danger_tool', danger)],
      ctx,
      undefined,
      onConfirm
    )

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(danger).not.toHaveBeenCalled()
    expect(result).toBe('ok')
  })

  it('records a tool trace with per-call outcomes', async () => {
    const ok = vi.fn(async () => ({ success: true }))
    const fail = vi.fn(async () => ({ success: false, error: 'nope' }))
    responses.push(
      {
        content: null,
        toolCalls: [
          { id: '1', name: 'ok_tool', input: {} },
          { id: '2', name: 'fail_tool', input: {} },
        ],
        stopReason: USE,
      },
      { content: 'done', toolCalls: [], stopReason: END }
    )

    const trace: ToolTrace[] = []
    await runAgentLoop(
      'sys',
      [{ role: 'user', content: 'go' }],
      [tool('ok_tool', ok), tool('fail_tool', fail)],
      ctx,
      undefined, // onIntermediateMessage
      undefined, // onConfirmationRequired
      undefined, // providerOverride
      trace
    )

    expect(trace).toHaveLength(2)
    expect(trace.find((t) => t.name === 'ok_tool')?.ok).toBe(true)
    expect(trace.find((t) => t.name === 'fail_tool')?.ok).toBe(false)
    expect(trace.every((t) => typeof t.ms === 'number')).toBe(true)
  })

  it('catches a throwing tool and keeps going', async () => {
    const boom = vi.fn(async () => {
      throw new Error('kaboom')
    })
    responses.push(
      { content: null, toolCalls: [{ id: '1', name: 'boom', input: {} }], stopReason: USE },
      { content: 'recovered', toolCalls: [], stopReason: END }
    )

    const result = await runAgentLoop('sys', [{ role: 'user', content: 'x' }], [tool('boom', boom)], ctx)

    expect(boom).toHaveBeenCalledTimes(1)
    expect(result).toBe('recovered')
  })

  it('returns a graceful fallback when stuck in a tool loop', async () => {
    const echo = vi.fn(async () => ({ success: true }))
    // Always ask for a tool — never ends.
    mockChat.mockImplementation(async () => ({
      content: null,
      toolCalls: [{ id: 'x', name: 'echo', input: {} }],
      stopReason: USE,
    }))

    const result = await runAgentLoop('sys', [{ role: 'user', content: 'loop' }], [tool('echo', echo)], ctx)

    expect(result).toMatch(/stuck in a loop/i)
    expect(mockChat).toHaveBeenCalledTimes(10) // MAX_ITERATIONS
  })
})
