import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase before importing the modules under test.
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock }),
}))

import { MockManager, getOrStart, runInSandbox, stopSession, getProvider, USD_PER_SECOND } from '@/lib/computer/manager'
import type { ComputerSessionRow } from '@/lib/computer/manager'

const USER_ID = '11111111-1111-1111-1111-111111111111'

// ---- flexible supabase fake ------------------------------------------------

interface Row {
  [k: string]: unknown
}

function makeDb(tables: Record<string, Row[]>) {
  const updates: { table: string; patch: Row }[] = []
  const inserts: { table: string; row: Row }[] = []
  const impl = (table: string) => {
    const rows = tables[table] ?? (tables[table] = [])
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      gte: () => builder,
      update: (patch: Row) => {
        updates.push({ table, patch })
        return builder
      },
      insert: (row: Row) => {
        inserts.push({ table, row })
        // Behave like Postgres: the row lands (with defaults) and is
        // readable by a following .select().single().
        rows.push({ id: `row-${inserts.length}`, ...row })
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

function setDb(tables: Record<string, Row[]>) {
  const db = makeDb(tables)
  fromMock.mockImplementation(db.impl)
  return db
}

// ---- tests -----------------------------------------------------------------

describe('getProvider', () => {
  it('defaults to the mock when no E2B key exists', () => {
    const prevKey = process.env.E2B_API_KEY
    const prevMock = process.env.E2B_SANDBOX_MOCK
    delete process.env.E2B_API_KEY
    delete process.env.E2B_SANDBOX_MOCK
    try {
      expect(getProvider()).toBeInstanceOf(MockManager)
    } finally {
      if (prevKey !== undefined) process.env.E2B_API_KEY = prevKey
      if (prevMock !== undefined) process.env.E2B_SANDBOX_MOCK = prevMock
    }
  })
})

describe('MockManager lifecycle', () => {
  it('start → run → stop', async () => {
    const mgr = new MockManager()
    const { sandboxId } = await mgr.start()
    expect(sandboxId).toMatch(/^mock-/)
    expect(await mgr.status(sandboxId)).toBe('running')
    const res = await mgr.run(sandboxId, 'echo hi')
    expect(res.stdout).toBe('$ echo hi')
    await mgr.stop(sandboxId)
    expect(await mgr.status(sandboxId)).toBe('stopped')
  })

  it('running a stopped sandbox fails honestly', async () => {
    const mgr = new MockManager()
    const { sandboxId } = await mgr.start()
    await mgr.stop(sandboxId)
    const res = await mgr.run(sandboxId, 'echo hi')
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('not running')
  })
})

describe('getOrStart (persistent per-user)', () => {
  beforeEach(() => {
    delete process.env.E2B_API_KEY
    process.env.E2B_SANDBOX_MOCK = '1'
  })

  it('starts a new session when none exists', async () => {
    const db = setDb({ computer_sessions: [] })
    const { session, resumed } = await getOrStart(USER_ID, { from: db.impl } as never)
    expect(resumed).toBe(false)
    expect(session.status).toBe('running')
    expect(String(session.sandbox_id)).toMatch(/^mock-/)
    expect(db.inserts.some((i) => i.table === 'computer_sessions')).toBe(true)
  })

  it('reuses and resumes the user\'s sleeping session', async () => {
    const db = setDb({
      computer_sessions: [
        {
          id: 'sess-1',
          user_id: USER_ID,
          sandbox_id: 'mock-existing',
          status: 'sleeping',
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
          killed_reason: null,
        },
      ],
    })
    const { session, resumed } = await getOrStart(USER_ID, { from: db.impl } as never)
    expect(resumed).toBe(true)
    expect(session.sandbox_id).toBe('mock-existing')
    expect(session.status).toBe('running')
    // no new sandbox started
    expect(db.inserts.some((i) => i.table === 'computer_sessions')).toBe(false)
    expect(db.updates.some((u) => u.table === 'computer_sessions')).toBe(true)
  })
})

describe('runInSandbox metering', () => {
  beforeEach(() => {
    process.env.E2B_SANDBOX_MOCK = '1'
    delete process.env.E2B_API_KEY
  })

  it('meters wall-clock seconds since last activity into the ledger', async () => {
    const tenMinAgo = new Date(Date.now() - 600_000).toISOString()
    const db = setDb({
      computer_sessions: [
        {
          id: 'sess-1',
          user_id: USER_ID,
          sandbox_id: 'mock-live',
          status: 'running',
          started_at: tenMinAgo,
          last_activity_at: tenMinAgo,
          killed_reason: null,
        },
      ],
      spend_events: [],
    })

    // capture the ledger write from recordSpend (insert through the same fake)
    const result = await runInSandbox(USER_ID, 'echo hi', { from: db.impl } as never)
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.billedSeconds).toBeGreaterThanOrEqual(590)
    expect(result.billedSeconds).toBeLessThanOrEqual(610)
    // insert args recorded via our fake's insert path
    const spendInsert = db.inserts.find((i) => i.table === 'spend_events')
    expect(spendInsert).toBeDefined()
    expect(Number(spendInsert!.row.amount_usd)).toBeCloseTo(result.billedSeconds * USD_PER_SECOND, 6)
    expect(String(spendInsert!.row.memo)).toMatch(/^sess-1:\d+s$/)
  })

  it('stopSession marks the row killed with a reason (server-side kill)', async () => {
    const session: ComputerSessionRow = {
      id: 'sess-1',
      user_id: USER_ID,
      sandbox_id: 'mock-live',
      status: 'running',
      started_at: null,
      last_activity_at: null,
      killed_reason: null,
    }
    const db = setDb({ computer_sessions: [session as unknown as Row] })
    await stopSession(session, 'hard_cap_exceeded', { from: db.impl } as never)
    const upd = db.updates.find((u) => u.table === 'computer_sessions')
    expect(upd).toBeDefined()
    expect(upd!.patch.status).toBe('killed')
    expect(upd!.patch.killed_reason).toBe('hard_cap_exceeded')
  })
})

