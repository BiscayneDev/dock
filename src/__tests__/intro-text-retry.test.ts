import { describe, it, expect, vi, beforeEach } from 'vitest'

const { send, create } = vi.hoisted(() => ({ send: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(() => ({})) }))
vi.mock('@/lib/spectrum/app', () => ({
  getSpectrumApp: vi.fn(async () => ({})),
  getImessage: vi.fn(async () => ({ space: { create } })),
}))
import { sendIntroText } from '@/lib/spectrum/waitlist-invites'

describe('sendIntroText retry', () => {
  beforeEach(() => {
    send.mockReset()
    create.mockReset()
    create.mockResolvedValue({ send })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  it('succeeds on the first attempt without waiting', async () => {
    send.mockResolvedValue(undefined)
    expect(await sendIntroText('+15550001111', 'hi', [1, 1])).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('retries a target-not-allowed rejection and then succeeds', async () => {
    send.mockRejectedValueOnce(new Error('[spectrum-imessage] Target not allowed for this project')).mockResolvedValue(undefined)
    expect(await sendIntroText('+15550001111', 'hi', [1, 1])).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })
  it('gives up after the last delay and reports false', async () => {
    send.mockRejectedValue(new Error('Target not allowed for this project'))
    expect(await sendIntroText('+15550001111', 'hi', [1, 1])).toBe(false)
    expect(send).toHaveBeenCalledTimes(3)
  })
})
