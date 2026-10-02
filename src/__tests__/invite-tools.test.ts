import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const grantRow = { data: { granted: 5 } }
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => grantRow }) }) }),
  }),
}))

import { invitesPromptLine, inviteToolsFor } from '@/lib/spectrum/user-invites'
import { buildSystemPrompt } from '@/lib/spectrum/dinghy'

const ctx = {} as never
beforeEach(() => { rpc.mockReset(); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.getdinghy.sh') })

describe('invite tools', () => {
  it('invite_status reads the real balance', async () => {
    rpc.mockResolvedValue({ data: 3, error: null })
    const [status] = inviteToolsFor('any;-;+15551230001', 'member')
    const r = await status.execute({}, ctx)
    expect(r).toEqual({ success: true, data: { granted: 5, used: 2, remaining: 3 } })
  })

  it('invite_link mints once, returns a /i/ link, and a retry reuses it', async () => {
    rpc.mockResolvedValue({ data: 2, error: null })
    const [, link] = inviteToolsFor('any;-;+15551230002', 'member')
    const a = await link.execute({}, ctx)
    expect(a.success).toBe(true)
    const url = (a as { data: { link: string; remaining_after: number } }).data.link
    expect(url).toMatch(/^https:\/\/www\.getdinghy\.sh\/i\/[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect((a as { data: { remaining_after: number } }).data.remaining_after).toBe(2)
    const b = await link.execute({}, ctx)
    expect((b as { data: { link: string } }).data.link).toBe(url)
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('out of invites: error, no link', async () => {
    rpc.mockResolvedValue({ data: -1, error: null })
    const [, link] = inviteToolsFor('any;-;+15551230003', 'member')
    const r = await link.execute({ people: 3 }, ctx)
    expect(r.success).toBe(false)
  })

  it('prompt mentions invites only when there is something to give, never a made-up number', () => {
    expect(buildSystemPrompt([], false, { google: false, wallet: false })).not.toContain('invite_status')
    expect(buildSystemPrompt([], false, { google: false, wallet: false, invitesLeft: 0 })).not.toContain('invite_status')
    const p = buildSystemPrompt([], false, { google: false, wallet: false, invitesLeft: 3 })
    expect(p).toContain('You have 3 invites to give out')
    expect(p).toContain('invite_status')
    expect(invitesPromptLine(1)).toContain('1 invite to give out')
    expect(invitesPromptLine(3)).not.toMatch(/[*`#—]/)
  })
})
