import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }))

import { estimateCostUsd, readGatewayUsage, recordUsage, spendToolFor, periodStart } from '@/lib/spectrum/metering'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

const ctx = { userId: '', telegramId: 0, telegramChatId: 0, name: '', timezone: 'America/New_York', tokens: {} }
const headers = (h: Record<string, string>) => ({ headers: { get: (k: string) => h[k.toLowerCase()] ?? null } })

beforeEach(() => rpc.mockReset())

describe('reading gateway usage', () => {
  it('prefers the gateway cost + model headers', () => {
    const u = readGatewayUsage(
      headers({ 'x-shipyard-cost-usd': '0.00123', 'x-shipyard-model': 'hopscotch/haiku' }),
      { model: 'm', usage: { prompt_tokens: 1000, completion_tokens: 200 } },
      'req-model', 850
    )
    expect(u).toEqual({ model: 'hopscotch/haiku', inputTokens: 1000, outputTokens: 200, costUsd: 0.00123, latencyMs: 850 })
  })

  it('falls back to the body model and no cost when headers are missing', () => {
    const u = readGatewayUsage(headers({}), { usage: { prompt_tokens: 5 } }, 'anthropic/claude-haiku-4-5-20251001', 10)
    expect(u.model).toBe('anthropic/claude-haiku-4-5-20251001')
    expect(u.costUsd).toBeNull()
    expect(u.outputTokens).toBe(0)
  })

  it('estimates from list prices only for known models', () => {
    expect(estimateCostUsd('anthropic/claude-haiku-4-5-20251001', 1_000_000, 1_000_000)).toBe(6)
    expect(estimateCostUsd('mystery-model', 10, 10)).toBeNull()
  })
})

describe('recording', () => {
  it('writes one row per call, estimating when the gateway gave no cost', async () => {
    rpc.mockResolvedValue({ error: null })
    await recordUsage('chat-1', 'reply', [
      { model: 'anthropic/claude-haiku-4-5', inputTokens: 1000, outputTokens: 100, costUsd: null, latencyMs: 12.4 },
      { model: 'x', inputTokens: 1, outputTokens: 1, costUsd: 0.5, latencyMs: 3 },
    ])
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc.mock.calls[0]).toEqual(['dinghy_record_usage', expect.objectContaining({
      p_chat_guid: 'chat-1', p_cost_usd: 0.0015, p_cost_estimated: true, p_latency_ms: 12,
    })])
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_cost_usd: 0.5, p_cost_estimated: false })
  })

  it('does nothing for an empty turn and surfaces RPC errors to the caller', async () => {
    await recordUsage('c', 'reply', [])
    expect(rpc).not.toHaveBeenCalled()
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    await expect(recordUsage('c', 'reply', [{ model: 'x', inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 }])).rejects.toThrow('boom')
  })
})

describe('spend_summary scope', () => {
  const summary = {
    calls: 3, input_tokens: 300, output_tokens: 30, cost_usd: 0.012, estimated_calls: 0,
    chats: [{ chat_guid: 'owner-chat', handle: '+1305', calls: 2, tokens: 200, cost_usd: 0.01 }, { chat_guid: 'm', handle: '+1925', calls: 1, tokens: 130, cost_usd: 0.002 }],
  }

  it('members are pinned to their own chat', async () => {
    rpc.mockResolvedValue({ data: { ...summary, chats: null }, error: null })
    const r = await spendToolFor('member-chat', false).execute({ period: 'all' }, ctx)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_chat_guid: 'member-chat', p_all: false })
    expect(r.data).toMatchObject({ scope: 'this chat only', cost: '$0.01', calls: 3 })
    expect((r.data as Record<string, unknown>).by_member).toBeUndefined()
  })

  it('the owner gets totals and a per-member breakdown', async () => {
    rpc.mockResolvedValue({ data: summary, error: null })
    const r = await spendToolFor('owner-chat', true).execute({}, ctx)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_all: true })
    const d = r.data as { period: string; by_member: { who: string }[] }
    expect(d.period).toBe('week')
    expect(d.by_member.map((m) => m.who)).toEqual(['you', '+1925'])
  })

  it('week starts at local midnight six days back', () => {
    const now = new Date('2026-09-23T17:00:00Z') // 1pm EDT
    expect(periodStart('today', now).toISOString()).toBe('2026-09-23T04:00:00.000Z')
    expect(periodStart('week', now).toISOString()).toBe('2026-09-17T04:00:00.000Z')
  })

  it('prompt mentions spend_summary only when offered', () => {
    expect(buildSystemPrompt([], false, { google: false, wallet: false, spend: true })).toContain('spend_summary')
    expect(buildSystemPrompt([], false, { google: false, wallet: false })).not.toContain('spend_summary')
  })
})
