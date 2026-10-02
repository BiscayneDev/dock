import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rpcMock = vi.fn(async () => ({ data: 'prop-1', error: null }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc: rpcMock, from: vi.fn() }) }))

import { proposeLoose, takeLooseProposal } from '@/lib/spectrum/actions'

const ctx = { userId: 'u1' } as never

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('loose proposals are per chat', () => {
  it('one chat never receives another chat\'s draft, and a draft is taken once', async () => {
    await proposeLoose('chat-A', ctx, 'computer_browse', { task: 'a' })
    expect(takeLooseProposal('chat-B')).toBeNull()
    expect(takeLooseProposal('chat-A')?.payload.task).toBe('a')
    expect(takeLooseProposal('chat-A')).toBeNull()
  })
  it('expires unclaimed drafts', async () => {
    await proposeLoose('chat-A', ctx, 'computer_browse', { task: 'a' })
    vi.advanceTimersByTime(3 * 60 * 1000)
    expect(takeLooseProposal('chat-A')).toBeNull()
  })
})
