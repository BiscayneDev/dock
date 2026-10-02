import { beforeEach, describe, expect, it, vi } from 'vitest'
const { session, read, chain, calls, result } = vi.hoisted(() => ({
  session: vi.fn(), read: vi.fn(), calls: [] as unknown[][], result: { data: [] as unknown[], error: null as unknown }, chain: {} as Record<string, unknown>
}))
vi.mock('@/lib/auth/session', () => ({ getSession: session }))
vi.mock('@/lib/profile/paybox-read', () => ({ readPortfolio: read }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from: (table: string) => { calls.push(['from', table]); return chain } }) }))
import { GET as walletGet } from '@/app/api/user/paybox/portfolio/route'
import { listFiles, getFile } from '@/lib/profile/files'
beforeEach(() => {
  session.mockReset(); read.mockReset(); calls.length = 0; result.data = []; result.error = null
  for (const method of ['select', 'eq', 'is', 'or', 'order', 'range', 'maybeSingle']) chain[method] = (...args: unknown[]) => { calls.push([method, ...args]); return chain }
  chain.then = (resolve: (r: unknown) => unknown) => Promise.resolve(resolve(result))
})
describe('session-owned reads', () => {
  it('rejects anonymous wallet reads without touching PayBox', async () => { session.mockResolvedValue(null); expect((await walletGet()).status).toBe(401); expect(read).not.toHaveBeenCalled() })
  it('only uses authenticated owner identity and prevents shared caches', async () => {
    session.mockResolvedValue({ userId: 'owner' }); read.mockResolvedValue({ state: 'no_wallets', wallets: [] })
    const response = await walletGet(); expect(read).toHaveBeenCalledWith('owner'); expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
  it('does not leak provider errors or turn them into zero', async () => { session.mockResolvedValue({ userId: 'owner' }); read.mockRejectedValue(new Error('token secret')); const response = await walletGet(); expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret') })
  it('filters every list by owner and excludes deleted copies', async () => {
    await listFiles('owner'); expect(calls).toContainEqual(['eq', 'user_id', 'owner']); expect(calls).toContainEqual(['is', 'deleted_at', null])
    const select = calls.find(c => c[0] === 'select'); expect(select?.[1]).not.toContain('markdown')
  })
  it('filters details by owner AND id, not id alone', async () => { await getFile('owner', '00000000-0000-4000-8000-000000000001'); expect(calls).toContainEqual(['eq', 'user_id', 'owner']); expect(calls).toContainEqual(['eq', 'id', '00000000-0000-4000-8000-000000000001']) })
  it('rejects malformed identifiers without reading the database', async () => { expect(await getFile('owner', 'bad-id')).toBeNull(); expect(calls).toEqual([]) })
})
