import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn(async () => {})
const chatWithTools = vi.fn()
const chat = vi.fn()
const recordUsage = vi.fn()
const isOver = vi.fn()
const claimLimitNotice = vi.fn()
const ackResume = vi.fn(async () => {})

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/integrations/google-accounts', () => ({ googleAccountsOf: () => [] }))
vi.mock('@/lib/spectrum/app', () => ({
  getSpectrumApp: async () => ({}),
  getImessage: async () => ({ space: { get: async () => ({ send }) } }),
}))
vi.mock('@/lib/spectrum/outbox', () => ({ claimOutboxBatch: async () => [], markOutboxFailed: async () => {}, markOutboxSent: async () => {} }))
vi.mock('@/lib/spectrum/dinghy', () => ({
  chat: (...a: unknown[]) => chat(...a),
  chatWithTools: (...a: unknown[]) => chatWithTools(...a),
  MAX_HISTORY: 10,
  wantsAnotherGoogle: () => false,
}))
vi.mock('@/lib/spectrum/connect-lines', () => ({ googleConnectedLine: () => 'google is connected ✓', isConnectRequest: () => false }))
vi.mock('@/lib/spectrum/imessage-tools', () => ({
  capabilitiesFor: () => ({ google: false }),
  loadImessageToolContext: async () => ({ userId: 'u1' }),
  toolsFor: () => [{ name: 't' }],
}))
vi.mock('@/lib/spectrum/actions', () => ({ actionToolsFor: () => null, renderProposal: () => '' }))
vi.mock('@/lib/allowance', () => ({
  allowanceUsedUpMessage: () => "You've used today's allowance.",
  claimLimitNotice: (...a: unknown[]) => claimLimitNotice(...a),
  isOverDailyAllowance: (...a: unknown[]) => isOver(...a),
}))
vi.mock('@/lib/spectrum/metering', () => ({ recordUsage: (...a: unknown[]) => recordUsage(...a) }))
vi.mock('@/lib/spectrum/config', () => ({ GATEWAY_URL: 'g', SHIPYARD_API_KEY: 'k', SHIPYARD_MODEL: 'auto' }))
vi.mock('spectrum-ts', () => ({ typing: () => ({}) }))
vi.mock('@/lib/files/send', () => ({ sendFileWithPreview: async () => {} }))
vi.mock('@/lib/spectrum/brief-card-send', () => ({ sendBrief: async () => {} }))
vi.mock('@/lib/files/render', () => ({ renderFile: async () => ({}) }))
vi.mock('@/lib/files/tool', () => ({ parseFileInput: () => ({}) }))
vi.mock('@/spectrum/store', () => ({
  ackResume: (id: string) => ackResume(id),
  claimPendingResume: async () => ({ id: 'r1', pendingRequest: 'what is on my calendar', provider: 'google' }),
  listUnresumedResumeChats: async () => ['chat-1'],
  loadFacts: async () => [],
  loadHistory: async () => [],
  saveMessage: async () => {},
}))
vi.mock('@/lib/spectrum/plain-text', () => ({ toPlainText: (s: string) => s }))

import { GET } from '@/app/api/cron/spectrum-sweep/route'
import { NextRequest } from 'next/server'

const req = () => new NextRequest('http://x/api/cron/spectrum-sweep', { headers: { authorization: 'Bearer s' } })

beforeEach(() => {
  process.env.CRON_SECRET = 's'
  for (const m of [send, chatWithTools, chat, recordUsage, isOver, claimLimitNotice, ackResume]) m.mockClear()
  isOver.mockResolvedValue({ over: false })
  claimLimitNotice.mockResolvedValue(true)
  recordUsage.mockResolvedValue(undefined)
})

describe('spectrum-sweep google-connect resume metering', () => {
  it('passes onUsage and records usage under source "resume"', async () => {
    chatWithTools.mockImplementation(async (_h: unknown, opts: { onUsage: (u: unknown) => void }) => {
      opts.onUsage({ model: 'm', inputTokens: 10, outputTokens: 5, costUsd: 0.01, latencyMs: 5 })
      return { reply: 'you have 2 meetings' }
    })
    await GET(req())
    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith('chat-1', 'resume', [
      expect.objectContaining({ inputTokens: 10, outputTokens: 5 }),
    ])
    expect(ackResume).toHaveBeenCalledWith('r1')
  })

  it('records usage even when the model call throws midway, and leaves the resume un-acked', async () => {
    chatWithTools.mockImplementation(async (_h: unknown, opts: { onUsage: (u: unknown) => void }) => {
      opts.onUsage({ model: 'm', inputTokens: 1, outputTokens: 1, costUsd: 0.001, latencyMs: 1 })
      throw new Error('gateway 500')
    })
    await GET(req())
    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(ackResume).not.toHaveBeenCalled()
  })

  it('over allowance: no model call, confirms the connection with the one daily notice, acks', async () => {
    isOver.mockResolvedValue({ over: true })
    await GET(req())
    expect(chatWithTools).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.stringContaining('google is connected'))
    expect(send).toHaveBeenCalledWith(expect.stringContaining("used today's allowance"))
    expect(ackResume).toHaveBeenCalledWith('r1')
  })

  it('over allowance after the daily notice was already sent: connection line only', async () => {
    isOver.mockResolvedValue({ over: true })
    claimLimitNotice.mockResolvedValue(false)
    await GET(req())
    const sent = (send.mock.calls as unknown as string[][]).map((c) => c[0]).join('|')
    expect(sent).toContain('google is connected')
    expect(sent).not.toContain('allowance')
  })
})
