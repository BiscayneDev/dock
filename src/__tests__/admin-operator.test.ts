import { describe, expect, it, vi, beforeEach } from 'vitest'

const { table, rpc } = vi.hoisted(() => ({ table: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: table, rpc }) }))
import { markWaitlistFirstInbound } from '@/lib/spectrum/waitlist-invites'

function identity(handle: string | null, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: handle ? { handle } : null, error })
  table.mockReturnValueOnce({ select: () => ({ eq: () => ({ maybeSingle }) }) })
}

describe('first inbound activation', () => {
  beforeEach(() => { table.mockReset(); rpc.mockReset() })
  it('never activates a missing or malformed phone', async () => {
    await markWaitlistFirstInbound(null, 'chat-a')
    await markWaitlistFirstInbound('not-a-phone', 'chat-a')
    expect(table).not.toHaveBeenCalled()
  })
  it('does not activate when the authenticated chat handle differs', async () => {
    identity('+15550001111')
    await markWaitlistFirstInbound('+15550002222', 'chat-a')
    expect(table).toHaveBeenCalledTimes(1)
  })
  it('only changes invited rows for a matching authenticated sender', async () => {
    identity('+15550001111')
    const matchLimit = vi.fn().mockResolvedValue({ data: [{ id: 'row-1' }], error: null })
    const matchStatus = vi.fn().mockReturnValue({ limit: matchLimit })
    const matchPhone = vi.fn().mockReturnValue({ eq: matchStatus })
    table.mockReturnValueOnce({ select: () => ({ eq: matchPhone }) })
    const eqStatus = vi.fn().mockResolvedValue({ error: null })
    const eqId = vi.fn().mockReturnValue({ eq: eqStatus })
    const update = vi.fn().mockReturnValue({ eq: eqId })
    table.mockReturnValueOnce({ update })
    await markWaitlistFirstInbound('+15550001111', 'chat-a')
    expect(matchPhone).toHaveBeenCalledWith('phone', '+15550001111')
    expect(eqId).toHaveBeenCalledWith('id', 'row-1')
    expect(eqStatus).toHaveBeenCalledWith('status', 'invited')
    expect(update.mock.calls[0][0]).toMatchObject({ status: 'active' })
  })
})
