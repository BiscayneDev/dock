import { describe, expect, it } from 'vitest'
import { buildCallRow } from '@/lib/spectrum/gateway-log'

const ctx = { source: 'tool_loop' as const, iteration: 2, requestedModel: 'auto', toolsOffered: 30, promptChars: 40000, deadlineAt: 100_000 }
const headers = (h: Record<string, string>) => ({ status: 200, headers: { get: (n: string) => h[n.toLowerCase()] ?? null } })

describe('buildCallRow', () => {
  it('records a success with model, tokens, cached tokens, cost and latency', () => {
    const r = buildCallRow(ctx, 'ok', 1_000, headers({ 'x-shipyard-model': 'openai/gpt-5', 'x-shipyard-cost-usd': '0.031' }),
      { usage: { prompt_tokens: 10_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 9_600 } } }, 28_000)
    expect(r).toMatchObject({ outcome: 'ok', resolved_model: 'openai/gpt-5', input_tokens: 10_000, cached_tokens: 9_600, output_tokens: 1_000, latency_ms: 27_000, cost_usd: 0.031, tools_offered: 30, iteration: 2, deadline_left_ms: 99_000 })
  })
  it('records a deadline with no response and unknown fields null', () => {
    const r = buildCallRow(ctx, 'deadline', 1_000, undefined, undefined, 86_000)
    expect(r).toMatchObject({ outcome: 'deadline', latency_ms: 85_000, resolved_model: null, input_tokens: null, http_status: null, provider: null })
  })
  it('records an http error status', () => {
    expect(buildCallRow(ctx, 'http_error', 0, { status: 502, headers: { get: () => null } }, undefined, 500)).toMatchObject({ outcome: 'http_error', http_status: 502 })
  })
})

import { logGatewayCall, requestedLabel } from '@/lib/spectrum/gateway-log'
describe('requestedLabel', () => {
  it('logs auto when routing prefs are sent, the pinned model otherwise', () => {
    expect(requestedLabel('anthropic/x', { providers: ['hopscotch'] })).toBe('auto')
    expect(requestedLabel('anthropic/x', undefined)).toBe('anthropic/x')
  })
})
describe('logGatewayCall', () => {
  it('never throws', async () => {
    await expect(logGatewayCall({} as never)).resolves.toBeUndefined()
  })
})
