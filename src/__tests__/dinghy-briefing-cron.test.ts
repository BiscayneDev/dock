import { describe, it, expect, vi, beforeEach } from 'vitest'

const claimBrief = vi.fn()
const completeBrief = vi.fn()
const releaseBrief = vi.fn()
const chatWithTools = vi.fn()
const enqueueOutbox = vi.fn()
const recordUsage = vi.fn()
const events: string[] = []

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.not = () => Promise.resolve({ data: [{ chat_guid: 'chat-1', user_id: 'u1' }] })
      q.eq = () => q
      q.maybeSingle = () => Promise.resolve({ data: null })
      if (t === 'waitlist') return { select: () => Promise.resolve({ count: 4 }) }
      return q
    },
  }),
}))
vi.mock('@/lib/integrations/google', () => ({ getAuthedClient: async () => ({}) }))
vi.mock('googleapis', () => ({
  google: { gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: 'x@example.com' } }) } }) },
}))
vi.mock('@/lib/spectrum/app', () => ({
  getSpectrumApp: async () => ({}),
  getImessage: async () => ({ space: { get: async () => ({ send: async () => {} }) } }),
}))
vi.mock('@/lib/spectrum/imessage-tools', () => ({
  IMESSAGE_READ_TOOLS: [],
  loadImessageToolContext: async () => ({ userId: 'u1', timezone: 'America/New_York', tokens: { google: {} } }),
}))
const forceKey = vi.fn()
vi.mock('@/lib/spectrum/briefing', () => ({
  isBriefingEnabled: async () => true,
  briefingForceKey: (...a: unknown[]) => forceKey(...a),
  clearBriefingForce: async () => {},
  MUTE_FOOTER: 'mute',
}))
vi.mock('@/lib/spectrum/brief-claim', async (orig) => {
  const real = await orig<typeof import('@/lib/spectrum/brief-claim')>()
  return {
    ...real,
    claimBrief: (...a: unknown[]) => { events.push('claim'); return claimBrief(...a) },
    completeBrief: (...a: unknown[]) => completeBrief(...a),
    releaseBrief: (...a: unknown[]) => releaseBrief(...a),
  }
})
vi.mock('@/lib/spectrum/outbox', () => ({
  enqueueOutbox: (...a: unknown[]) => enqueueOutbox(...a),
  markOutboxSent: async () => {},
}))
vi.mock('@/lib/allowance', () => ({ isOverDailyAllowance: async () => ({ over: false }) }))
vi.mock('@/lib/spectrum/metering', () => ({ recordUsage: (...a: unknown[]) => recordUsage(...a) }))
vi.mock('@/lib/spectrum/dinghy', () => ({
  chatWithTools: (...a: unknown[]) => { events.push('model'); return chatWithTools(...a) },
}))
vi.mock('@/lib/spectrum/config', () => ({ GATEWAY_URL: 'http://gw', SHIPYARD_API_KEY: 'k', SHIPYARD_MODEL: 'auto' }))
vi.mock('@/spectrum/store', () => ({ loadFacts: async () => [], saveMessage: async () => {} }))
vi.mock('@/lib/time-utils', () => ({ isInQuietHours: () => false, getCurrentHour: () => 8 }))
vi.mock('@/lib/spectrum/brief-card-send', () => ({
  BRIEF_JSON_SPEC: 'json',
  cardDate: () => 'd',
  cardTime: () => 't',
  parseBriefReply: () => null,
  sendBrief: async () => {},
}))
vi.mock('@/lib/spectrum/location', () => ({ briefLocation: async () => null }))
vi.mock('@/lib/weather/brief-weather', () => ({ cardWeather: async () => null }))
vi.mock('@/lib/spectrum/plain-text', () => ({ toPlainText: (s: string) => s }))

import { GET } from '@/app/api/cron/dinghy-briefing/route'
import { NextRequest } from 'next/server'

const req = () => new NextRequest('http://x/api/cron/dinghy-briefing', { headers: { authorization: 'Bearer s' } })

beforeEach(() => {
  process.env.CRON_SECRET = 's'
  for (const m of [claimBrief, completeBrief, releaseBrief, chatWithTools, enqueueOutbox, recordUsage, forceKey]) m.mockReset()
  events.length = 0
  forceKey.mockResolvedValue(null)
  claimBrief.mockResolvedValue({ ok: true })
  chatWithTools.mockResolvedValue({ reply: 'good morning' })
  enqueueOutbox.mockResolvedValue('ob-1')
  completeBrief.mockResolvedValue(undefined)
  releaseBrief.mockResolvedValue(undefined)
  recordUsage.mockResolvedValue(undefined)
})

describe('dinghy-briefing cron claim ordering', () => {
  it('claims before the model call and marks the day sent once queued', async () => {
    const res = await (await GET(req())).json()
    expect(events).toEqual(['claim', 'model'])
    expect(res.briefings).toBe(1)
    expect(completeBrief).toHaveBeenCalledTimes(1)
    expect(releaseBrief).not.toHaveBeenCalled()
  })

  it('pays for NO generation when the claim is held by another run', async () => {
    claimBrief.mockResolvedValue({ ok: false, reason: 'held' })
    const res = await (await GET(req())).json()
    expect(chatWithTools).not.toHaveBeenCalled()
    expect(enqueueOutbox).not.toHaveBeenCalled()
    expect(res).toMatchObject({ briefings: 0, skipped: 1, errors: 0 })
  })

  it('fails closed (no model call) when the claim errors', async () => {
    claimBrief.mockResolvedValue({ ok: false, reason: 'error', error: 'db down' })
    const res = await (await GET(req())).json()
    expect(chatWithTools).not.toHaveBeenCalled()
    expect(res.errors).toBe(1)
  })

  it('overlapping runs: only the run that wins the claim generates', async () => {
    claimBrief.mockResolvedValueOnce({ ok: true }).mockResolvedValue({ ok: false, reason: 'held' })
    await Promise.all([GET(req()), GET(req())])
    expect(chatWithTools).toHaveBeenCalledTimes(1)
  })

  it('releases the lease when the model call throws, so a retry can claim', async () => {
    chatWithTools.mockRejectedValue(new Error('gateway 500'))
    const res = await (await GET(req())).json()
    expect(releaseBrief).toHaveBeenCalledTimes(1)
    expect(completeBrief).not.toHaveBeenCalled()
    expect(res.errors).toBe(1)
  })

  it('releases the lease when the outbox enqueue fails', async () => {
    enqueueOutbox.mockResolvedValue(null)
    await GET(req())
    expect(releaseBrief).toHaveBeenCalledTimes(1)
    expect(completeBrief).not.toHaveBeenCalled()
  })

  it('never releases after queueing, even if the sent-mark fails (no duplicate generation)', async () => {
    completeBrief.mockRejectedValue(new Error('mark failed'))
    const res = await (await GET(req())).json()
    expect(releaseBrief).not.toHaveBeenCalled()
    expect(res.briefings).toBe(1)
  })

  it('brief-me-now claims under its own request key', async () => {
    forceKey.mockResolvedValue('2026-10-01T12:00:00Z')
    await GET(req())
    expect(claimBrief).toHaveBeenCalledWith('u1', expect.any(String), 'now:2026-10-01T12:00:00Z')
  })
})
