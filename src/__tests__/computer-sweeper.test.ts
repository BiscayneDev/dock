import { describe, it, expect, vi, beforeEach } from 'vitest'

const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: fromMock }) }))
vi.mock('@/lib/payments/spend-caps', () => ({ recordSpend: vi.fn(async () => {}) }))
vi.mock('@/lib/computer/metering', () => ({ killIfOverCap: vi.fn(async () => false) }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/computer-sweeper/route'
import { getProvider, MockManager } from '@/lib/computer/manager'
import { recordSpend } from '@/lib/payments/spend-caps'
import vercelJson from '../../vercel.json'

const updates: Record<string, unknown>[] = []

function setSessions(rows: Record<string, unknown>[]) {
  updates.length = 0
  fromMock.mockImplementation(() => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.in = () => b
    b.eq = () => b
    b.update = (patch: Record<string, unknown>) => {
      updates.push(patch)
      return b
    }
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null })
    return b
  })
}

function req() {
  return new NextRequest('http://x/api/cron/computer-sweeper', { headers: { authorization: 'Bearer s3cret' } })
}

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  delete process.env.E2B_API_KEY
  vi.clearAllMocks()
})

describe('computer sweeper', () => {
  it('is scheduled in vercel.json', () => {
    const paths = (vercelJson as { crons: { path: string }[] }).crons.map((c) => c.path)
    expect(paths).toContain('/api/cron/computer-sweeper')
  })

  it('pauses (not kills) an idle session and bills the idle time once', async () => {
    const mgr = getProvider() as MockManager
    const { sandboxId } = await mgr.start()
    const old = new Date(Date.now() - 12 * 60_000).toISOString()
    setSessions([{ id: 's1', user_id: 'u1', sandbox_id: sandboxId, status: 'running', last_activity_at: old }])
    const res = await GET(req())
    const body = await res.json()
    expect(body.slept).toBe(1)
    expect(mgr.isPaused(sandboxId)).toBe(true)
    expect(await mgr.status(sandboxId)).toBe('running')
    expect(updates.some((u) => u.status === 'sleeping')).toBe(true)
    expect(recordSpend).toHaveBeenCalledTimes(1)
  })

  it('leaves a recently active session alone and does not bump its baseline', async () => {
    const recent = new Date(Date.now() - 3 * 60_000).toISOString()
    setSessions([{ id: 's2', user_id: 'u1', sandbox_id: 'mock-x', status: 'running', last_activity_at: recent }])
    const res = await GET(req())
    const body = await res.json()
    expect(body.slept).toBe(0)
    expect(updates).toHaveLength(0)
    expect(recordSpend).not.toHaveBeenCalled()
  })
})
