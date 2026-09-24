import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Mock Supabase before importing the module under test.
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock }),
}))

import { assertWithinCap, checkCap, recordSpend } from '@/lib/payments/spend-caps'

const USER_ID = '11111111-1111-1111-1111-111111111111'

// Chain builder for the two queries assertWithinCap makes:
// spend_events (sum) then spend_limits (cap). Results are consumed in order.
const results: Array<{ data: unknown; error?: { message: string } | null }> = []
function chainSelect(result: { data: unknown; error?: { message: string } | null }) {
  results.push(result)
  fromMock.mockImplementation(() => {
    const r = results.shift() ?? { data: null }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(r),
      then: (resolve: (v: unknown) => void) => resolve(r),
    }
    return chain
  })
}

// Chain builder for recordSpend's insert.
function chainInsert(result: { error?: { message: string } | null }) {
  const insert = vi.fn().mockReturnThis()
  const chain = {
    insert,
  }
  fromMock.mockImplementation(() => {
    return {
      ...chain,
      then: (resolve: (v: unknown) => void) =>
        resolve(result.error ? { error: result.error } : { error: null }),
    }
  })
  // supabase-js insert() returns a thenable postgrest builder
  ;(chain as { insert: Mock }).insert.mockReturnValue({
    then: (resolve: (v: unknown) => void) =>
      resolve(result.error ? { error: result.error } : { error: null }),
  })
  return insert
}

describe('checkCap (pure)', () => {
  it('blocks when cap is 0', () => {
    expect(checkCap(0, 0, 1).allowed).toBe(false)
  })

  it('allows under cap', () => {
    expect(checkCap(0, 100, 99).allowed).toBe(true)
  })

  it('blocks over cap', () => {
    expect(checkCap(0, 100, 101).allowed).toBe(false)
  })

  it('blocks cumulative spend over cap', () => {
    expect(checkCap(99, 100, 2).allowed).toBe(false)
    expect(checkCap(99, 100, 1).allowed).toBe(true)
  })

  it('allows exactly at cap', () => {
    expect(checkCap(99, 100, 1).allowed).toBe(true)
  })
})

describe('assertWithinCap', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('passes when under cap', async () => {
    chainSelect({ data: [{ amount_usd: 10 }] }) // spend today
    chainSelect({ data: { daily_usd: 100 } }) // cap
    await expect(assertWithinCap(USER_ID, 50)).resolves.toBeUndefined()
  })

  it('sums spend across sources (paybox + wallet + x402 + recipe rows)', async () => {
    // Rows from different sources all land in spend_events; the sum is over
    // the shared ledger, not any single rail.
    chainSelect({
      data: [
        { amount_usd: 10, source: 'paybox_payment' },
        { amount_usd: 0.5, source: 'wallet_send' },
        { amount_usd: 1, source: 'x402' },
        { amount_usd: 3.25, source: 'recipe' },
      ],
    })
    chainSelect({ data: { daily_usd: 100 } })
    // 14.75 spent + 86 requested = 100.75 > 100 → blocked
    await expect(assertWithinCap(USER_ID, 86)).rejects.toThrow(/cap exceeded/i)
  })

  it('throws when today spend + amount exceeds cap', async () => {
    chainSelect({ data: [{ amount_usd: 60 }, { amount_usd: 39 }] })
    chainSelect({ data: { daily_usd: 100 } })
    await expect(assertWithinCap(USER_ID, 2)).rejects.toThrow(/cap exceeded/i)
  })

  it('blocks everything when cap is 0', async () => {
    chainSelect({ data: [] })
    chainSelect({ data: { daily_usd: 0 } })
    await expect(assertWithinCap(USER_ID, 1)).rejects.toThrow(/cap exceeded/i)
  })

  it('defaults cap to 50 when no spend_limits row exists', async () => {
    chainSelect({ data: [] }) // spend today: 0
    chainSelect({ data: null }) // no cap row
    await expect(assertWithinCap(USER_ID, 49)).resolves.toBeUndefined()
    await expect(assertWithinCap(USER_ID, 51)).rejects.toThrow(/cap exceeded/i)
  })

  it('fails closed when the ledger read errors', async () => {
    chainSelect({ data: null, error: { message: 'boom' } })
    await expect(assertWithinCap(USER_ID, 1)).rejects.toThrow(/failed to read daily spend/i)
  })
})

describe('recordSpend', () => {
  beforeEach(() => {
    fromMock.mockReset()
  })

  it('inserts a spend_events row with the given source and amount', async () => {
    const insert = chainInsert({})
    await expect(
      recordSpend(USER_ID, 'paybox_payment', 4.2, 'coffee')
    ).resolves.toBeUndefined()
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER_ID,
        source: 'paybox_payment',
        amount_usd: 4.2,
        memo: 'coffee',
      })
    )
  })

  it('fails closed when the ledger write errors', async () => {
    chainInsert({ error: { message: 'insert failed' } })
    await expect(recordSpend(USER_ID, 'wallet_send', 0)).rejects.toThrow(
      /failed to record spend in ledger/i
    )
  })
})
