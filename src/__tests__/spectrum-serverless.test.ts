import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// Mock Supabase before importing the modules under test (same pattern as
// connect-token.test.ts).
const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

import { computeBackoffMs, getSpectrumConfig, OUTBOX_LEASE_MS } from '@/lib/spectrum/config'
import { isContactCardRequest, wantsGoogle } from '@/lib/spectrum/dinghy'
import { claimInboundDelivery, enqueueOutbox } from '@/lib/spectrum/outbox'

describe('computeBackoffMs', () => {
  it('doubles from 30s and caps at 30 minutes', () => {
    expect(computeBackoffMs(1)).toBe(30_000)
    expect(computeBackoffMs(2)).toBe(60_000)
    expect(computeBackoffMs(3)).toBe(120_000)
    expect(computeBackoffMs(10)).toBe(30 * 60 * 1000)
    expect(computeBackoffMs(100)).toBe(30 * 60 * 1000)
  })

  it('treats attempts <= 0 as the first retry', () => {
    expect(computeBackoffMs(0)).toBe(30_000)
  })
})

describe('getSpectrumConfig (fail closed)', () => {
  const base = {
    SPECTRUM_PROJECT_ID: 'proj',
    SPECTRUM_PROJECT_SECRET: 'secret',
  }

  it('throws when SPECTRUM_WEBHOOK_SECRET is missing', () => {
    expect(() => getSpectrumConfig({ ...base } as NodeJS.ProcessEnv)).toThrow(/SPECTRUM_WEBHOOK_SECRET/)
  })

  it('throws when project credentials are missing', () => {
    expect(() =>
      getSpectrumConfig({ SPECTRUM_WEBHOOK_SECRET: 'whsec' } as NodeJS.ProcessEnv)
    ).toThrow(/SPECTRUM_PROJECT_ID/)
  })

  it('returns the config when all three are set', () => {
    const cfg = getSpectrumConfig({ ...base, SPECTRUM_WEBHOOK_SECRET: 'whsec' } as NodeJS.ProcessEnv)
    expect(cfg.webhookSecret).toBe('whsec')
  })
})

describe('message classification', () => {
  it('detects contact card requests', () => {
    expect(isContactCardRequest('send me your contact card')).toBe(true)
    expect(isContactCardRequest('save your details')).toBe(true)
    expect(isContactCardRequest('what is my calendar like')).toBe(false)
  })

  it('detects google intent', () => {
    expect(wantsGoogle('check my gmail')).toBe(true)
    expect(wantsGoogle('what meetings do I have today')).toBe(true)
    expect(wantsGoogle('hello there')).toBe(false)
  })
})

describe('claimInboundDelivery', () => {
  beforeEach(() => fromMock.mockReset())

  it('returns true for a new delivery', async () => {
    fromMock.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) })
    expect(await claimInboundDelivery('msg-1', 'guid-1')).toBe(true)
  })

  it('returns false on a unique violation (redelivery)', async () => {
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } }),
    })
    expect(await claimInboundDelivery('msg-1', 'guid-1')).toBe(false)
  })

  it('fails open on transient errors (duplicate beats silence)', async () => {
    fromMock.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: { code: '08006', message: 'connection failure' } }),
    })
    expect(await claimInboundDelivery('msg-1', 'guid-1')).toBe(true)
  })
})

describe('enqueueOutbox', () => {
  beforeEach(() => fromMock.mockReset())

  it('returns the row id on success', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    fromMock.mockReturnValue({ insert: vi.fn().mockReturnValue({ select }) })
    expect(await enqueueOutbox('guid-1', 'reply', 'hi')).toBe('row-1')
  })

  it('returns null on failure (send still attempted, logged untracked)', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } })
    const select = vi.fn().mockReturnValue({ single })
    fromMock.mockReturnValue({ insert: vi.fn().mockReturnValue({ select }) })
    expect(await enqueueOutbox('guid-1', 'reply', 'hi')).toBeNull()
  })
})

describe('outbox lease', () => {
  it('uses the #21-style 60s lease', () => {
    expect(OUTBOX_LEASE_MS).toBe(60_000)
  })
})
