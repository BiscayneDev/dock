import { describe, it, expect, vi } from 'vitest'

const rpcMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ rpc: rpcMock }),
}))

import { allowanceUsedUpMessage, claimLimitNotice, getDailyUsage, isOverDailyAllowance } from '@/lib/allowance'

const usageRow = (over: boolean) => ({
  data: {
    tz: 'America/New_York',
    day_start: '2026-09-23T04:00:00+00:00',
    llm_cost_usd: over ? 2.1 : 0.4,
    sandbox_cost_usd: 0,
    cost_usd: over ? 2.1 : 0.4,
    allowance_usd: 2.0,
    remaining_usd: over ? 0 : 1.6,
    over,
    resets_at: '2026-09-24T04:00:00+00:00',
  },
  error: null,
})

describe('getDailyUsage', () => {
  it('maps the RPC row into DailyUsage', async () => {
    rpcMock.mockResolvedValue(usageRow(false))
    const usage = await getDailyUsage({ chatGuid: 'chat-1' })
    expect(usage.over).toBe(false)
    expect(usage.allowanceUsd).toBe(2.0)
    expect(usage.remainingUsd).toBe(1.6)
    expect(rpcMock).toHaveBeenCalledWith('dinghy_daily_usage', {
      p_chat_guid: 'chat-1',
      p_user_id: null,
      p_tz: null,
    })
  })
})

describe('isOverDailyAllowance', () => {
  it('reports over at the limit', async () => {
    rpcMock.mockResolvedValue(usageRow(true))
    expect((await isOverDailyAllowance({ chatGuid: 'chat-1' })).over).toBe(true)
  })

  it('fails OPEN on metering errors — a broken meter never mutes the product', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'function missing' } })
    const res = await isOverDailyAllowance({ chatGuid: 'chat-1' })
    expect(res.over).toBe(false)
    expect(res.usage).toBeNull()
  })
})

describe('claimLimitNotice', () => {
  it('true exactly once (the insert wins), false afterwards', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null })
    rpcMock.mockResolvedValueOnce({ data: false, error: null })
    expect(await claimLimitNotice('chat-1')).toBe(true)
    expect(await claimLimitNotice('chat-1')).toBe(false)
  })

  it('fails to false (silence) on error', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'down' } })
    expect(await claimLimitNotice('chat-1')).toBe(false)
  })
})

describe('allowanceUsedUpMessage', () => {
  it('is the one plain at-limit message', () => {
    expect(allowanceUsedUpMessage()).toContain('midnight')
  })
})
