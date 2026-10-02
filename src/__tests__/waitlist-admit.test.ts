import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  claimed: [] as { id: string; email: string; requested_by: string }[],
  people: {} as Record<string, { id: string; status: string; phone: string | null }>,
  doneLastHour: 0,
  updates: [] as { id: string; patch: Record<string, unknown> }[],
}))
const runInvites = vi.hoisted(() => vi.fn())

vi.mock('@/lib/spectrum/waitlist-invites', () => ({ runWaitlistInvites: runInvites }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    rpc: async () => ({ data: state.claimed, error: null }),
    from: (table: string) => {
      if (table === 'waitlist') {
        return { select: () => ({ eq: (_c: string, email: string) => ({ maybeSingle: async () => ({ data: state.people[email] ?? null }) }) }) }
      }
      return {
        select: () => ({ eq: () => ({ gte: async () => ({ count: state.doneLastHour }) }) }),
        update: (patch: Record<string, unknown>) => ({ eq: async (_c: string, id: string) => { state.updates.push({ id, patch }); return {} } }),
      }
    },
  }),
}))
import { processAdmitQueue } from '@/lib/spectrum/waitlist-admit'

const row = (id: string, email: string) => ({ id, email, requested_by: 'instinct' })
const statusOf = (id: string) => state.updates.filter((u) => u.id === id).map((u) => u.patch.status).pop()

describe('processAdmitQueue', () => {
  beforeEach(() => {
    state.claimed = []; state.people = {}; state.doneLastHour = 0; state.updates = []
    runInvites.mockReset()
    runInvites.mockResolvedValue('Emailed 1: Denny -> +16282647704')
  })
  it('runs the invite flow for exactly one email on a joined row with a phone', async () => {
    state.claimed = [row('a', 'denny@x.com')]
    state.people['denny@x.com'] = { id: 'w1', status: 'joined', phone: '+15550001111' }
    expect(await processAdmitQueue()).toEqual({ done: 1, failed: 0, skipped: 0 })
    expect(runInvites).toHaveBeenCalledWith('admit-queue:instinct', { kind: 'email', email: 'denny@x.com' })
    expect(statusOf('a')).toBe('done')
  })
  it('skips unknown emails, non-joined rows and rows without a phone, without inviting', async () => {
    state.claimed = [row('a', 'nobody@x.com'), row('b', 'inv@x.com'), row('c', 'nophone@x.com'), row('d', 'bad')]
    state.people['inv@x.com'] = { id: 'w2', status: 'invited', phone: '+15550002222' }
    state.people['nophone@x.com'] = { id: 'w3', status: 'joined', phone: null }
    expect(await processAdmitQueue()).toEqual({ done: 0, failed: 0, skipped: 4 })
    expect(runInvites).not.toHaveBeenCalled()
  })
  it('records a failure and keeps going', async () => {
    state.claimed = [row('a', 'a@x.com'), row('b', 'b@x.com')]
    state.people['a@x.com'] = { id: 'w1', status: 'joined', phone: '+15550001111' }
    state.people['b@x.com'] = { id: 'w2', status: 'joined', phone: '+15550002222' }
    runInvites.mockRejectedValueOnce(new Error('boom'))
    expect(await processAdmitQueue()).toEqual({ done: 1, failed: 1, skipped: 0 })
    expect(statusOf('a')).toBe('failed')
  })
  it('stops at the hourly cap and puts the row back to pending', async () => {
    state.claimed = [row('a', 'a@x.com')]
    state.people['a@x.com'] = { id: 'w1', status: 'joined', phone: '+15550001111' }
    state.doneLastHour = 10
    expect(await processAdmitQueue()).toEqual({ done: 0, failed: 0, skipped: 0 })
    expect(runInvites).not.toHaveBeenCalled()
    expect(statusOf('a')).toBe('pending')
  })
})
