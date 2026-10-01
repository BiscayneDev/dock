import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Stateful fake of the briefing claim tables. claim_dinghy_brief and
 * enqueue_dinghy_brief mirror migration 057 (including lease expiry, attempt
 * cap, and the single-transaction enqueue + 'sent' flip), with a controllable
 * clock, so reclaim scenarios are exercised for real instead of via mocks.
 */
type ClaimRow = { status: 'claimed' | 'sent'; leaseExpiresAt: number; attempts: number }
const db = {
  now: 1_000_000,
  claims: new Map<string, ClaimRow>(),
  outbox: [] as { chat_guid: string; kind: string; text: string }[],
  failEnqueue: null as null | 'before' | 'response_lost',
}
const k = (u: string, d: string, r: string) => `${u}|${d}|${r}`

function rpc(name: string, a: Record<string, unknown>) {
  if (name === 'claim_dinghy_brief') {
    const key = k(a.p_user_id as string, a.p_local_day as string, a.p_request_key as string)
    const row = db.claims.get(key)
    const lease = db.now + (a.p_lease_ms as number)
    if (!row) {
      db.claims.set(key, { status: 'claimed', leaseExpiresAt: lease, attempts: 1 })
      return Promise.resolve({ data: true, error: null })
    }
    if (row.status === 'claimed' && row.leaseExpiresAt < db.now && row.attempts < (a.p_max_attempts as number)) {
      row.leaseExpiresAt = lease
      row.attempts++
      return Promise.resolve({ data: true, error: null })
    }
    return Promise.resolve({ data: false, error: null })
  }
  if (name === 'enqueue_dinghy_brief') {
    if (db.failEnqueue === 'before') return Promise.resolve({ data: null, error: { message: 'db blip' } })
    const key = k(a.p_user_id as string, a.p_local_day as string, a.p_request_key as string)
    const row = db.claims.get(key)
    if (!row) return Promise.resolve({ data: null, error: { message: 'no brief claim' } })
    if (row.status === 'sent') return Promise.resolve({ data: null, error: null })
    // One transaction: both effects or neither.
    db.outbox.push({ chat_guid: a.p_chat_guid as string, kind: a.p_kind as string, text: a.p_text as string })
    row.status = 'sent'
    if (db.failEnqueue === 'response_lost') return Promise.resolve({ data: null, error: { message: 'connection reset' } })
    return Promise.resolve({ data: `ob-${db.outbox.length}`, error: null })
  }
  return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } })
}

const chatWithTools = vi.fn()
const recordUsage = vi.fn()
const spaceSend = vi.fn()
const forceKey = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    rpc,
    from: (t: string) => {
      if (t === 'waitlist') return { select: () => Promise.resolve({ count: 4 }) }
      if (t === 'dinghy_brief_delivery') {
        return {
          update: () => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: (c: string, v: unknown) => {
                filters[c] = v
                return chain
              },
              then: (res: (v: { error: null }) => void) => {
                // releaseBrief: expire the lease of an unfinished claim only.
                const row = db.claims.get(k(filters.user_id as string, filters.local_day as string, filters.request_key as string))
                if (row && row.status === (filters.status ?? row.status) && filters.status === 'claimed') row.leaseExpiresAt = 0
                res({ error: null })
              },
            }
            return chain
          },
        }
      }
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.not = () => Promise.resolve({ data: [{ chat_guid: 'chat-1', user_id: 'u1' }] })
      q.eq = () => q
      q.maybeSingle = () => Promise.resolve({ data: null })
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
  getImessage: async () => ({ space: { get: async () => ({ send: (...a: unknown[]) => spaceSend(...a) }) } }),
}))
vi.mock('@/lib/spectrum/imessage-tools', () => ({
  IMESSAGE_READ_TOOLS: [],
  loadImessageToolContext: async () => ({ userId: 'u1', timezone: 'America/New_York', tokens: { google: {} } }),
}))
vi.mock('@/lib/spectrum/briefing', () => ({
  isBriefingEnabled: async () => true,
  briefingForceKey: (...a: unknown[]) => forceKey(...a),
  clearBriefingForce: async () => {},
  MUTE_FOOTER: 'mute',
}))
vi.mock('@/lib/spectrum/outbox', () => ({ markOutboxSent: async () => {} }))
vi.mock('@/lib/allowance', () => ({ isOverDailyAllowance: async () => ({ over: false }) }))
vi.mock('@/lib/spectrum/metering', () => ({ recordUsage: (...a: unknown[]) => recordUsage(...a) }))
vi.mock('@/lib/spectrum/dinghy', () => ({ chatWithTools: (...a: unknown[]) => chatWithTools(...a) }))
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
import { BRIEF_LEASE_MS, BRIEF_MAX_ATTEMPTS } from '@/lib/spectrum/brief-claim'
import { NextRequest } from 'next/server'

const req = () => new NextRequest('http://x/api/cron/dinghy-briefing', { headers: { authorization: 'Bearer s' } })
const run = async () => (await GET(req())).json()
const claimRow = () => [...db.claims.values()][0]

beforeEach(() => {
  process.env.CRON_SECRET = 's'
  for (const m of [chatWithTools, recordUsage, spaceSend, forceKey]) m.mockReset()
  db.now = 1_000_000
  db.claims.clear()
  db.outbox.length = 0
  db.failEnqueue = null
  forceKey.mockResolvedValue(null)
  chatWithTools.mockResolvedValue({ reply: 'good morning' })
  recordUsage.mockResolvedValue(undefined)
  spaceSend.mockResolvedValue(undefined)
})

describe('dinghy-briefing cron: claim before the model call', () => {
  it('generates once, queues once, and ends with the day marked sent', async () => {
    const res = await run()
    expect(res.briefings).toBe(1)
    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(db.outbox).toHaveLength(1)
    expect(claimRow().status).toBe('sent')
  })

  it('a replayed or overlapping run pays for no second generation', async () => {
    await run()
    const res = await run()
    expect(res).toMatchObject({ briefings: 0, skipped: 1 })
    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(db.outbox).toHaveLength(1)
  })

  it('a live lease held by another run blocks generation', async () => {
    db.claims.set(k('u1', new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()), 'daily'), {
      status: 'claimed', leaseExpiresAt: db.now + 60_000, attempts: 1,
    })
    const res = await run()
    expect(chatWithTools).not.toHaveBeenCalled()
    expect(res.skipped).toBe(1)
  })

  it('brief-me-now claims under its own key and is not blocked by the daily brief', async () => {
    await run()
    forceKey.mockResolvedValue('2026-10-01T12:00:00Z')
    const res = await run()
    expect(res.briefings).toBe(1)
    expect(chatWithTools).toHaveBeenCalledTimes(2)
    expect(db.outbox).toHaveLength(2)
    expect(db.claims.size).toBe(2)
  })
})

describe('dinghy-briefing cron: failure windows never produce a second brief', () => {
  it('model failure releases the lease; the retry claims it and sends exactly one brief', async () => {
    chatWithTools.mockRejectedValueOnce(new Error('gateway 500'))
    const first = await run()
    expect(first.errors).toBe(1)
    expect(db.outbox).toHaveLength(0)
    expect(claimRow().status).toBe('claimed')
    const second = await run() // released lease is immediately reclaimable
    expect(second.briefings).toBe(1)
    expect(db.outbox).toHaveLength(1)
    expect(claimRow().status).toBe('sent')
  })

  it('enqueue failure (nothing written) releases the lease; the retry sends exactly one', async () => {
    db.failEnqueue = 'before'
    const first = await run()
    expect(first.errors).toBe(1)
    expect(db.outbox).toHaveLength(0)
    db.failEnqueue = null
    const second = await run()
    expect(second.briefings).toBe(1)
    expect(db.outbox).toHaveLength(1)
  })

  it('crash/lost response AFTER the enqueue committed: lease expiry cannot reclaim, no second generation', async () => {
    db.failEnqueue = 'response_lost' // DB committed outbox + 'sent'; caller sees an error
    const first = await run()
    expect(first.errors).toBe(1)
    expect(db.outbox).toHaveLength(1)
    expect(claimRow().status).toBe('sent') // atomic: queued implies done
    db.failEnqueue = null
    db.now += BRIEF_LEASE_MS + 1 // lease would have expired
    const second = await run()
    expect(second).toMatchObject({ briefings: 0, skipped: 1 })
    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(db.outbox).toHaveLength(1)
  })

  it('direct-send failure after queueing: outbox row exists for the sweep; expiry still cannot reclaim', async () => {
    spaceSend.mockRejectedValue(new Error('spectrum down'))
    const first = await run()
    expect(first.briefings).toBe(1)
    expect(db.outbox).toHaveLength(1)
    db.now += BRIEF_LEASE_MS + 1
    await run()
    expect(chatWithTools).toHaveBeenCalledTimes(1)
    expect(db.outbox).toHaveLength(1)
  })

  it('process death mid-generation: after lease expiry a later run reclaims (bounded attempts)', async () => {
    // Simulate a run that claimed and died before queueing: claim row left 'claimed'.
    chatWithTools.mockImplementationOnce(async () => {
      throw new Error('killed') // finally-release also skipped in a real kill; emulate by re-leasing
    })
    await run()
    claimRow().leaseExpiresAt = db.now + BRIEF_LEASE_MS // a real kill leaves the live lease
    expect((await run()).skipped).toBe(1) // still within lease: blocked
    db.now += BRIEF_LEASE_MS + 1
    expect((await run()).briefings).toBe(1) // expired: reclaimed once
    expect(db.outbox).toHaveLength(1)
  })

  it('stale run that lost its lease cannot deliver after the reclaiming run already queued', async () => {
    // Run A claims, then stalls inside the model call past its lease.
    let finishA: (v: { reply: string }) => void = () => {}
    chatWithTools.mockImplementationOnce(() => new Promise((r) => { finishA = r }))
    const a = run()
    await vi.waitFor(() => expect(chatWithTools).toHaveBeenCalledTimes(1))
    db.now += BRIEF_LEASE_MS + 1
    const b = await run() // reclaims, generates, queues
    expect(b.briefings).toBe(1)
    finishA({ reply: 'late' })
    const aRes = await a
    expect(aRes).toMatchObject({ briefings: 0, skipped: 1 }) // enqueue sees 'sent' -> no send
    expect(db.outbox).toHaveLength(1)
    expect(db.outbox[0].text).toContain('good morning')
  })

  it('stops reclaiming after the retry budget is spent', async () => {
    for (let i = 0; i < BRIEF_MAX_ATTEMPTS; i++) {
      chatWithTools.mockImplementationOnce(async () => {
        throw new Error('boom')
      })
      await run()
      claimRow().leaseExpiresAt = db.now - 1
    }
    chatWithTools.mockClear()
    const res = await run()
    expect(chatWithTools).not.toHaveBeenCalled()
    expect(res.skipped).toBe(1)
  })
})
