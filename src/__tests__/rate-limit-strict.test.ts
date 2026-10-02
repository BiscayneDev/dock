import { describe, it, expect, vi } from 'vitest'
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ rpc }) }))
import { hitRateLimitStrict } from '@/lib/spectrum/rate-limit'

describe('hitRateLimitStrict', () => {
  it('blocks when the limiter errors or throws, passes ok through', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } })
    expect(await hitRateLimitStrict('k')).toBe('limited')
    rpc.mockRejectedValueOnce(new Error('boom'))
    expect(await hitRateLimitStrict('k')).toBe('limited')
    rpc.mockResolvedValueOnce({ data: 'ok', error: null })
    expect(await hitRateLimitStrict('k')).toBe('ok')
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await hitRateLimitStrict('k')).toBe('limited')
  })
})
