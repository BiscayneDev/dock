import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const updates: Record<string, unknown>[] = []
const eqCalls: [string, unknown][] = []
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    rpc: rpcMock,
    from: () => ({
      update: (v: Record<string, unknown>) => {
        updates.push(v)
        const chain: { eq: (c: string, x: unknown) => unknown } = {
          eq: (c: string, x: unknown) => {
            eqCalls.push([c, x])
            return eqCalls.length % 4 === 0 ? Promise.resolve({ error: null }) : chain
          },
        }
        return chain
      },
    }),
  }),
}))

import { BRIEF_LEASE_MS, BRIEF_MAX_ATTEMPTS, briefRequestKey, claimBrief, releaseBrief } from '@/lib/spectrum/brief-claim'

beforeEach(() => {
  rpcMock.mockReset()
  updates.length = 0
  eqCalls.length = 0
})

describe('briefRequestKey', () => {
  it('shares one key for the scheduled brief', () => {
    expect(briefRequestKey(null)).toBe('daily')
  })
  it('gives brief-me-now its own key per request', () => {
    expect(briefRequestKey('2026-10-01T12:00:00Z')).toBe('now:2026-10-01T12:00:00Z')
    expect(briefRequestKey('2026-10-01T12:00:00Z')).not.toBe(briefRequestKey(null))
  })
})

describe('claimBrief', () => {
  it('passes the lease and retry budget to the atomic rpc', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    expect(await claimBrief('u1', '2026-10-01', 'daily')).toEqual({ ok: true })
    expect(rpcMock).toHaveBeenCalledWith('claim_dinghy_brief', {
      p_user_id: 'u1', p_local_day: '2026-10-01', p_request_key: 'daily',
      p_lease_ms: BRIEF_LEASE_MS, p_max_attempts: BRIEF_MAX_ATTEMPTS,
    })
  })
  it('reports held when another run owns the day', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    expect(await claimBrief('u1', '2026-10-01', 'daily')).toEqual({ ok: false, reason: 'held' })
  })
  it('fails closed on rpc errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await claimBrief('u1', '2026-10-01', 'daily')).toEqual({ ok: false, reason: 'error', error: 'boom' })
  })
  it('lease outlasts the cron maxDuration (300s)', () => {
    expect(BRIEF_LEASE_MS).toBeGreaterThan(300_000)
  })
})

describe('releaseBrief', () => {
  it('expires the lease only for unfinished claims', async () => {
    await releaseBrief('u1', '2026-10-01', 'daily')
    expect(new Date(updates[0].lease_expires_at as string).getTime()).toBe(0)
    expect(eqCalls).toContainEqual(['status', 'claimed'])
  })
})
