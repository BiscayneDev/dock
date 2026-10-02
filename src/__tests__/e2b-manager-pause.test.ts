import { describe, it, expect, vi, beforeEach } from 'vitest'

// Fake just enough of the e2b SDK for E2BManager.pause.
const pauseMock = vi.fn()
vi.mock('e2b', () => {
  class NotFoundError extends Error {}
  return { NotFoundError, Sandbox: { pause: (id: string) => pauseMock(id) } }
})
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))

import { E2BManager, SandboxGoneError } from '@/lib/computer/manager'

describe('E2BManager.pause', () => {
  beforeEach(() => { pauseMock.mockReset() })

  it('pauses a live sandbox', async () => {
    pauseMock.mockResolvedValue(undefined)
    await expect(new E2BManager().pause('sbx-1')).resolves.toBeUndefined()
    expect(pauseMock).toHaveBeenCalledWith('sbx-1')
  })

  it('maps NotFoundError (sandbox expired before the sweeper) to SandboxGoneError', async () => {
    const { NotFoundError } = await import('e2b')
    pauseMock.mockRejectedValue(new NotFoundError("sandbox not found"))
    await expect(new E2BManager().pause('sbx-gone')).rejects.toBeInstanceOf(SandboxGoneError)
  })

  it('rethrows other errors untouched', async () => {
    const boom = new Error('rate limited')
    pauseMock.mockRejectedValue(boom)
    await expect(new E2BManager().pause('sbx-2')).rejects.toBe(boom)
  })
})
