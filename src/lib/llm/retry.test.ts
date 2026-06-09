import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { withRetry } from './retry'

describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries a transient (429) error then succeeds', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('rate limited'), { status: 429 })
      return 'ok'
    })

    const p = withRetry(fn, 'test')
    await vi.runAllTimersAsync()

    await expect(p).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retries on a network-style message even without a status', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls < 2) throw new Error('fetch failed: ECONNRESET')
      return 42
    })

    const p = withRetry(fn, 'test')
    await vi.runAllTimersAsync()

    await expect(p).resolves.toBe(42)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable (400) error', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 })
    })

    const p = withRetry(fn, 'test')
    const assertion = expect(p).rejects.toThrow('bad request')
    await vi.runAllTimersAsync()
    await assertion

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after the max attempts on a persistent error', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('overloaded'), { status: 503 })
    })

    const p = withRetry(fn, 'test', 3)
    const assertion = expect(p).rejects.toThrow('overloaded')
    await vi.runAllTimersAsync()
    await assertion

    expect(fn).toHaveBeenCalledTimes(3)
  })
})
