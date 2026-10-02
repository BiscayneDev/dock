import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getAdminSession, run } = vi.hoisted(() => ({ getAdminSession: vi.fn(), run: vi.fn() }))
vi.mock('@/lib/auth/admin', () => ({ getAdminSession }))
vi.mock('@/lib/spectrum/waitlist-invites', async () => {
  const actual = await vi.importActual<typeof import('@/lib/spectrum/waitlist-invites')>('@/lib/spectrum/waitlist-invites')
  return { ...actual, runWaitlistInvites: run }
})
import { POST } from '@/app/api/admin/waitlist-invite/route'

const post = (body: unknown) => POST(new Request('http://x/api/admin/waitlist-invite', { method: 'POST', body: JSON.stringify(body) }))

describe('admin waitlist invite', () => {
  beforeEach(() => { getAdminSession.mockReset(); run.mockReset() })
  it('rejects non-admins without running anything', async () => {
    getAdminSession.mockResolvedValue(null)
    expect((await post({ email: 'a@b.co' })).status).toBe(403)
    expect(run).not.toHaveBeenCalled()
  })
  it('invites one person by email', async () => {
    getAdminSession.mockResolvedValue({ userId: 'u1' })
    run.mockResolvedValue('Texted 1: x')
    const res = await post({ email: 'A@B.co' })
    expect(res.status).toBe(200)
    expect(run.mock.calls[0][1]).toEqual({ kind: 'email', email: 'a@b.co' })
  })
  it('invites the next N within the cap', async () => {
    getAdminSession.mockResolvedValue({ userId: 'u1' })
    run.mockResolvedValue('ok')
    await post({ next: 3 })
    expect(run.mock.calls[0][1]).toEqual({ kind: 'next', count: 3 })
  })
  it('rejects bad input', async () => {
    getAdminSession.mockResolvedValue({ userId: 'u1' })
    expect((await post({})).status).toBe(400)
    expect((await post({ next: 500 })).status).toBe(400)
    expect((await post({ email: 'not an email' })).status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })
})
