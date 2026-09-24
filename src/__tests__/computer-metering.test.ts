import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase before importing the modules under test.
const fromMock = vi.fn()
const rpcMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

import {
  assertComputerAllowed,
  getTodaySandboxSeconds,
  killIfOverCap,
  recordOveragePurchase,
} from '@/lib/computer/metering'
import type { ComputerSessionRow } from '@/lib/computer/manager'

const USER_ID = '11111111-1111-1111-1111-111111111111'

// ---- flexible supabase fake ------------------------------------------------

interface Row {
  [k: string]: unknown
}

interface SpendEvent {
  amount_usd: number | string
  memo: string | null
  created_at?: string
  currency?: string
}

function makeDb(tables: Record<string, Row[]>) {
  const updates: { table: string; patch: Row }[] = []
  const inserts: { table: string; row: Row }[] = []
  const impl = (table: string) => {
    const rows = tables[table] ?? []
    const builder = {
      select: (..._: unknown[]) => builder,
      eq: (..._: unknown[]) => builder,
      in: (..._: unknown[]) => builder,
      gte: (..._: unknown[]) => builder,
      update: (patch: Row) => {
        updates.push({ table, patch })
        return builder
      },
      insert: (row: Row) => {
        inserts.push({ table, row })
        return builder
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      single: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  return { impl, updates, inserts }
}

function spendRows(events: SpendEvent[]): Row[] {
  return events as unknown as Row[]
}

const settingsRow = (over: Row = {}) => ({
  user_id: USER_ID,
  daily_allowance_usd: 2.0,
  allowance_timezone: null,
  hard_cap_usd_per_day: 5.0,
  enabled: true,
  ...over,
})

// The daily-usage RPC answer: over/not-over the allowance.
const usageRpc = (over: boolean, costUsd = 0) => ({
  data: {
    tz: 'America/New_York',
    day_start: new Date().toISOString(),
    llm_cost_usd: costUsd,
    sandbox_cost_usd: 0,
    cost_usd: costUsd,
    allowance_usd: 2.0,
    remaining_usd: Math.max(2.0 - costUsd, 0),
    over,
    resets_at: new Date().toISOString(),
  },
  error: null,
})

const metered = (seconds: number): SpendEvent => ({
  amount_usd: (seconds * (0.17 / 3600)).toFixed(6),
  memo: `sess-1:${seconds}s`,
})

describe('getTodaySandboxSeconds', () => {
  beforeEach(() => {
    process.env.E2B_SANDBOX_MOCK = '1'
    delete process.env.E2B_API_KEY
  })

  it('sums metered rows but skips overage purchases', async () => {
    const db = makeDb({
      spend_events: spendRows([metered(600), metered(700), { amount_usd: 1.0, memo: 'overage:+21600s' }]),
    })
    fromMock.mockImplementation(db.impl)
    const seconds = await getTodaySandboxSeconds(USER_ID, { from: db.impl } as never)
    expect(seconds).toBe(1300)
  })
})

describe('assertComputerAllowed — allowance → needsApproval → blocked', () => {
  beforeEach(() => {
    process.env.E2B_SANDBOX_MOCK = '1'
    delete process.env.E2B_API_KEY
    rpcMock.mockReset()
  })

  it('allows under the daily allowance', async () => {
    const db = makeDb({
      computer_settings: [settingsRow()],
      spend_events: spendRows([metered(600)]),
    })
    fromMock.mockImplementation(db.impl)
    rpcMock.mockResolvedValue(usageRpc(false, 0.03))
    const res = await assertComputerAllowed(USER_ID, { from: db.impl, rpc: rpcMock } as never)
    expect(res.allowed).toBe(true)
  })

  it('asks for approval once the daily allowance is used up', async () => {
    const db = makeDb({
      computer_settings: [settingsRow()],
      spend_events: spendRows([metered(1800)]),
    })
    fromMock.mockImplementation(db.impl)
    rpcMock.mockResolvedValue(usageRpc(true, 2.1))
    const res = await assertComputerAllowed(USER_ID, { from: db.impl, rpc: rpcMock } as never)
    expect(res.allowed).toBe(false)
    expect('needsApproval' in res && res.needsApproval).toBe(true)
    if ('needsApproval' in res) expect(res.overageUsd).toBe(1.0)
  })

  it('allows again after an overage purchase, below the hard cap', async () => {
    const db = makeDb({
      computer_settings: [settingsRow()],
      spend_events: spendRows([metered(1800), { amount_usd: 1.0, memo: 'overage:+21600s' }]),
    })
    fromMock.mockImplementation(db.impl)
    rpcMock.mockResolvedValue(usageRpc(true, 2.1))
    const res = await assertComputerAllowed(USER_ID, { from: db.impl, rpc: rpcMock } as never)
    expect(res.allowed).toBe(true)
  })

  it('blocks when today total spend + projected overage exceeds the hard cap', async () => {
    // $4.50 money spend today + $1 projected overage > $5 cap
    const db = makeDb({
      computer_settings: [settingsRow({ hard_cap_usd_per_day: 5.0 })],
      spend_events: spendRows([metered(1800), { amount_usd: 4.5, memo: 'wallet_send', currency: 'USD' }]),
    })
    fromMock.mockImplementation(db.impl)
    rpcMock.mockResolvedValue(usageRpc(true, 2.1))
    const res = await assertComputerAllowed(USER_ID, { from: db.impl, rpc: rpcMock } as never)
    expect(res.allowed).toBe(false)
    expect('blocked' in res && res.blocked).toBe(true)
  })

  it('fails open when the usage meter errors', async () => {
    const db = makeDb({
      computer_settings: [settingsRow()],
      spend_events: spendRows([]),
    })
    fromMock.mockImplementation(db.impl)
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc down' } })
    const res = await assertComputerAllowed(USER_ID, { from: db.impl, rpc: rpcMock } as never)
    expect(res.allowed).toBe(true)
  })
})

describe('killIfOverCap — server-side kill switch', () => {
  beforeEach(() => {
    process.env.E2B_SANDBOX_MOCK = '1'
    delete process.env.E2B_API_KEY
  })

  it('kills when the hard cap is breached, via the caller-provided stop', async () => {
    const db = makeDb({
      computer_settings: [settingsRow({ hard_cap_usd_per_day: 5.0 })],
      spend_events: spendRows([{ amount_usd: 5.5, memo: 'wallet_send', currency: 'USD' }]),
    })
    fromMock.mockImplementation(db.impl)

    const stops: string[] = []
    const session = {
      id: 'sess-1',
      user_id: USER_ID,
      sandbox_id: 'sbx-1',
      status: 'running',
      started_at: null,
      last_activity_at: null,
      killed_reason: null,
    } as ComputerSessionRow

    const killed = await killIfOverCap(USER_ID, session, async (s, reason) => {
      stops.push(reason)
      await db.impl('computer_sessions').update({ status: 'killed', killed_reason: reason }).eq('id', s.id)
    }, { from: db.impl } as never)

    expect(killed).toBe(true)
    expect(stops).toHaveLength(1)
    expect(stops[0]).toContain('hard cap')
    const upd = db.updates.find((u) => u.table === 'computer_sessions')
    expect(upd?.patch.status).toBe('killed')
  })

  it('does nothing under the cap', async () => {
    const db = makeDb({
      computer_settings: [settingsRow({ hard_cap_usd_per_day: 5.0 })],
      spend_events: spendRows([metered(1800)]),
    })
    fromMock.mockImplementation(db.impl)
    const stop = vi.fn()
    const session = {
      id: 'sess-1',
      user_id: USER_ID,
      sandbox_id: 'sbx-1',
      status: 'running',
      started_at: null,
      last_activity_at: null,
      killed_reason: null,
    } as ComputerSessionRow
    const killed = await killIfOverCap(USER_ID, session, stop, { from: db.impl } as never)
    expect(killed).toBe(false)
    expect(stop).not.toHaveBeenCalled()
  })
})

describe('recordOveragePurchase', () => {
  it('writes an overage-flagged ledger row', async () => {
    const db = makeDb({ spend_events: [] })
    fromMock.mockImplementation(db.impl)
    await recordOveragePurchase(USER_ID, { from: db.impl } as never)
    const ins = db.inserts.find((i) => i.table === 'spend_events')
    expect(ins).toBeDefined()
    expect(Number(ins!.row.amount_usd)).toBe(1.0)
    expect(String(ins!.row.memo)).toMatch(/^overage:/)
  })
})
