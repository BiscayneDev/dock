import { describe, it, expect, vi } from 'vitest'
// paybox.ts pulls the PayBox SDK → @solana/web3.js (ERR_REQUIRE_ESM under
// vitest, the pre-existing baseline failure class). Mock the integration so
// only the tool definitions load.
vi.mock('@/lib/integrations/paybox', () => ({
  isPayboxConnected: (ctx: { tokens: Record<string, unknown> }) => Boolean(ctx.tokens.paybox),
  payboxRequired: (action: string) => ({ success: false, error: `Paybox is required for ${action}` }),
  getPayboxSdk: vi.fn(),
  agentResultToTool: vi.fn(),
}))
const { payboxOnramp } = await import('@/lib/tools/paybox')
const { toolsFor, capabilitiesFor } = await import('@/lib/spectrum/imessage-tools')
import type { UserContext } from '@/lib/llm/types'

function ctxWith(paybox: boolean): UserContext {
  return {
    userId: 'u1',
    chatGuid: 'chat1',
    tokens: paybox ? { paybox: 'tok' } : {},
  } as unknown as UserContext
}

describe('paybox_onramp', () => {
  it('is registered as a tool', () => {
    expect(payboxOnramp.name).toBe('paybox_onramp')
  })

  it('refuses without a Paybox connection', async () => {
    const res = await payboxOnramp.execute({ credentialId: 'c1', amountUsd: 25 }, ctxWith(false))
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/paybox/i)
  })

  it('is offered on iMessage when PayBox is connected, and not otherwise', () => {
    const connected = toolsFor(ctxWith(true))
    const guest = toolsFor(ctxWith(false))
    expect(connected.some((t) => t.name === 'paybox_onramp')).toBe(true)
    expect(guest.some((t) => t.name === 'paybox_onramp')).toBe(false)
    expect(capabilitiesFor(ctxWith(true)).wallet).toBe(true)
  })
})
