import { describe, it, expect } from 'vitest'
import { agentResultToTool, isPayboxConnected, payboxRequired } from './paybox'
import type { UserContext } from '@/lib/llm/types'

function ctxWith(tokens: Record<string, unknown>): UserContext {
  return { userId: 'u1', telegramId: 1, telegramChatId: 1, name: 't', timezone: 'UTC', tokens } as unknown as UserContext
}

describe('isPayboxConnected', () => {
  it('is true only when a paybox token is present', () => {
    expect(isPayboxConnected(ctxWith({ paybox: { accessToken: 'x' } }))).toBe(true)
    expect(isPayboxConnected(ctxWith({}))).toBe(false)
  })
})

describe('payboxRequired', () => {
  it('refuses with a connect prompt', () => {
    const r = payboxRequired('making a payment')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Paybox required/i)
    expect(r.error).toMatch(/making a payment/)
  })
})

describe('agentResultToTool', () => {
  it('maps success to the output value', () => {
    const r = agentResultToTool({
      request_id: 'r1',
      status: 'success',
      output: { value: { signature: '0xabc' } },
      approval_id: null,
      error: null,
    })
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ status: 'success', output: { signature: '0xabc' } })
  })

  it('surfaces pending_approval with the approval id and poll instruction', () => {
    const r = agentResultToTool({
      request_id: 'r2',
      status: 'pending_approval',
      output: null,
      approval_id: 'a1',
      error: null,
    })
    expect(r.success).toBe(true)
    expect(r.data).toMatchObject({ status: 'pending_approval', request_id: 'r2', approval_id: 'a1' })
  })

  it('maps denied and error to failures', () => {
    const denied = agentResultToTool({
      request_id: 'r3', status: 'denied', output: null, approval_id: null, error: 'merchant not allowed',
    })
    expect(denied.success).toBe(false)
    expect(denied.error).toMatch(/merchant not allowed/)

    const errored = agentResultToTool({
      request_id: 'r4', status: 'error', output: null, approval_id: null, error: 'internal',
    })
    expect(errored.success).toBe(false)
    expect(errored.error).toMatch(/internal/)
  })
})
