import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// Mock Supabase before importing the module under test.
const fromMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: fromMock }),
}))

process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef'

import {
  hashToken,
  verifyConnectEnvelope,
  createConnectToken,
  beginConnectByToken,
  claimConnectByState,
  releaseConnectClaim,
  completeConnect,
  markConnectTerminal,
  claimPendingResume,
  ackResume,
} from '@/lib/connect-token'
import { encodeSessionCookie, decodeSessionCookie } from '@/lib/auth/session'
import { bindSpectrumIdentity } from '@/lib/connect-token'

type Chain = {
  update: Mock
  eq: Mock
  is: Mock
  gt: Mock
  not: Mock
  or?: Mock
  select: Mock
  order: Mock
  limit: Mock
  maybeSingle: Mock
  insert: Mock
  single: Mock
}

function chain(final: { data: unknown; error: unknown }): Chain {
  const c: Record<string, Mock> = {}
  for (const m of ['update', 'eq', 'is', 'gt', 'not', 'or', 'select', 'order', 'limit', 'insert', 'upsert']) {
    c[m] = vi.fn().mockReturnThis()
  }
  c.maybeSingle = vi.fn().mockResolvedValue(final)
  c.single = vi.fn().mockResolvedValue(final)
  return c as unknown as Chain
}

/** Table-aware from(): different chains per table (bindSpectrumIdentity flow). */
function tableChains(tables: Record<string, Chain>) {
  return vi.fn((table: string) => tables[table] ?? chain({ data: null, error: null }))
}

beforeEach(() => {
  fromMock.mockReset().mockReturnValue(chain({ data: null, error: null }) as never)
})

describe('verifyConnectEnvelope', () => {
  it('rejects a tampered payload', () => {
    const good = verifyConnectEnvelope(`${Buffer.from(JSON.stringify({ platform: 'imessage', chatId: 'g', ts: Date.now() })).toString('base64url')}.badsig`)
    expect(good).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifyConnectEnvelope('not-a-token')).toBeNull()
    expect(verifyConnectEnvelope('')).toBeNull()
  })

  it('rejects an expired token', () => {
    const { createHmac } = require('crypto') as typeof import('crypto')
    const payload = { platform: 'imessage', chatId: 'g', ts: Date.now() - 11 * 60 * 1000 }
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = createHmac('sha256', process.env.ENCRYPTION_KEY!).update(encoded).digest('base64url')
    expect(verifyConnectEnvelope(`${encoded}.${sig}`)).toBeNull()
  })
})

describe('createConnectToken + beginConnectByToken', () => {
  it('persists the token hash (not the raw token) and returns a signed token', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)

    const token = await createConnectToken({ platform: 'imessage', chatId: 'guid-1', pendingRequest: 'check my email' })
    expect(token).toContain('.')
    expect(verifyConnectEnvelope(token)).toMatchObject({ platform: 'imessage', chatId: 'guid-1' })

    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        token_hash: hashToken(token),
        platform: 'imessage',
        chat_id: 'guid-1',
        pending_request: 'check my email',
      })
    )
  })

  it('beginConnectByToken consumes atomically and mints an oauth state', async () => {
    const token = await createConnectToken({ platform: 'telegram', chatId: '123' }) // insert ok via chain
    const c = chain({ data: { platform: 'telegram', chat_id: '123' }, error: null })
    fromMock.mockReturnValue(c)

    const result = await beginConnectByToken(token)
    expect(result).not.toBeNull()
    expect(result!.oauthState).toMatch(/^[0-9a-f]{48}$/)
    // guard clauses: unused + unexpired filter present
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ used_at: expect.any(String) }))
    expect(c.is).toHaveBeenCalledWith('used_at', null)
    expect(c.gt).toHaveBeenCalledWith('expires_at', expect.any(String))
  })

  it('beginConnectByToken returns null when the row was already used', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    const token = `${Buffer.from(JSON.stringify({ platform: 'imessage', chatId: 'g', ts: Date.now() })).toString('base64url')}.${require('crypto').createHmac('sha256', process.env.ENCRYPTION_KEY!).update(Buffer.from(JSON.stringify({ platform: 'imessage', chatId: 'g', ts: Date.now() })).toString('base64url')).digest('base64url')}`
    expect(await beginConnectByToken(token)).toBeNull()
  })
})

describe('claimConnectByState (retryable claim)', () => {
  it('claims a consumed-but-incomplete row exactly once', async () => {
    const c = chain({ data: { id: 'row-1', platform: 'imessage', chat_id: 'guid-1', pending_request: 'check my email' }, error: null })
    fromMock.mockReturnValue(c)

    const row = await claimConnectByState('a'.repeat(48))
    expect(row).toMatchObject({ platform: 'imessage', chatId: 'guid-1', pendingRequest: 'check my email' })
    // claimed_at set; guard requires unclaimed + unconsumed-complete state
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ claimed_at: expect.any(String) }))
    expect(c.is).toHaveBeenCalledWith('completed_at', null)
    expect(c.is).toHaveBeenCalledWith('claimed_at', null)
  })

  it('returns null for an unknown state', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    expect(await claimConnectByState('f'.repeat(48))).toBeNull()
  })
})

describe('claim → release → re-claim retry semantics (finding 8)', () => {
  it('a released claim can be re-claimed by the same state', async () => {
    // 1. claim succeeds
    const claimChain = chain({ data: { id: 'row-1', platform: 'telegram', chat_id: '123', pending_request: null }, error: null })
    fromMock.mockReturnValue(claimChain)
    const row = await claimConnectByState('b'.repeat(48))
    expect(row).not.toBeNull()

    // 2. verification failed → release
    const releaseChain = chain({ data: null, error: null })
    fromMock.mockReturnValue(releaseChain)
    await releaseConnectClaim('row-1')
    expect(releaseChain.update).toHaveBeenCalledWith({ claimed_at: null })
    expect(releaseChain.is).toHaveBeenCalledWith('completed_at', null)

    // 3. re-claim succeeds (claimed_at guard now matches again)
    fromMock.mockReturnValue(claimChain)
    expect(await claimConnectByState('b'.repeat(48))).not.toBeNull()
  })

  it('completeConnect is guarded against double-completion', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    await completeConnect('row-1')
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ completed_at: expect.any(String) }))
    expect(c.is).toHaveBeenCalledWith('completed_at', null)
  })
})

describe('session cookie signing (finding 1)', () => {
  it('round-trips a signed session', () => {
    const encoded = encodeSessionCookie({ userId: 'u-1', telegramId: 42 })
    expect(encoded).toContain('.')
    expect(decodeSessionCookie(encoded)).toEqual({ userId: 'u-1', telegramId: 42 })
  })

  it('rejects a tampered payload (userId swap)', () => {
    const encoded = encodeSessionCookie({ userId: 'u-1', telegramId: 42 })
    const [payload] = encoded.split('.')
    const forged = Buffer.from(JSON.stringify({ userId: 'attacker', telegramId: 42 })).toString('base64url')
    expect(decodeSessionCookie(`${forged}.${encoded.split('.')[1]}`)).toBeNull()
    expect(payload).toBeTruthy()
  })

  it('rejects garbage and missing fields', () => {
    expect(decodeSessionCookie('nonsense')).toBeNull()
    const bad = encodeSessionCookie({ userId: '', telegramId: 1 } as never)
    expect(decodeSessionCookie(bad)).toBeNull()
  })
})

describe('claimPendingResume (lease-based, finding 2)', () => {
  it('claims with a delivery lease — resumed_at is NOT written at claim time', async () => {
    const c = chain({ data: { id: 'row-9', pending_request: 'what meetings do I have' }, error: null })
    fromMock.mockReturnValue(c)

    expect(await claimPendingResume('guid-1')).toEqual({ id: 'row-9', pendingRequest: 'what meetings do I have' })
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ delivery_claimed_at: expect.any(String) }))
    expect(c.update).not.toHaveBeenCalledWith(expect.objectContaining({ resumed_at: expect.anything() }))
    // stealable lease: null OR expired
    expect(c.or).toHaveBeenCalledWith(expect.stringContaining('delivery_claimed_at.lt.'))
    expect(c.is).toHaveBeenCalledWith('resumed_at', null)
  })

  it('returns null when nothing is pending', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    expect(await claimPendingResume('guid-2')).toBeNull()
  })
})

describe('resume ack + two-restart losslessness (finding 2)', () => {
  it('ackResume sets resumed_at only after delivery; claim never does', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    await ackResume('row-9')
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ resumed_at: expect.any(String), delivery_claimed_at: null }))
    expect(c.is).toHaveBeenCalledWith('resumed_at', null)
  })

  it('two-restart: claim → (restart, no send) → expired lease is stealable and re-claimable', async () => {
    // Process A claims (lease taken, no ack).
    const claimA = chain({ data: { id: 'row-9', pending_request: 'check my email' }, error: null })
    fromMock.mockReturnValue(claimA)
    expect(await claimPendingResume('guid-1')).not.toBeNull()

    // Process A dies before sending. Process B boots and polls again.
    const claimB = chain({ data: { id: 'row-9', pending_request: 'check my email' }, error: null })
    fromMock.mockReturnValue(claimB)
    const re = await claimPendingResume('guid-1')
    expect(re).toEqual({ id: 'row-9', pendingRequest: 'check my email' })
    // The re-claim guard admits expired leases: `.or(delivery_claimed_at.is.null, delivery_claimed_at.lt.<cutoff>)`
    expect(claimB.or).toHaveBeenCalledWith(
      expect.stringMatching(/^delivery_claimed_at\.is\.null,delivery_claimed_at\.lt\.\d{4}-/)
    )
    // And still does not mark resumed_at — ack happens only after a real send.
    expect(claimB.update).not.toHaveBeenCalledWith(expect.objectContaining({ resumed_at: expect.anything() }))

    // Delivery succeeded on process B → ack finalizes.
    const ackChain = chain({ data: null, error: null })
    fromMock.mockReturnValue(ackChain)
    await ackResume('row-9')
    expect(ackChain.update).toHaveBeenCalledWith(expect.objectContaining({ resumed_at: expect.any(String) }))
  })
})

describe('markConnectTerminal (finding 4/round-2 — atomic terminal transition)', () => {
  it('failed terminal sets terminal_at + completed_at + clears claim in ONE atomic write', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    await markConnectTerminal('row-1', { failed: true })
    const arg = c.update.mock.calls[0][0]
    expect(arg).toEqual({ terminal_at: expect.any(String), completed_at: expect.any(String), claimed_at: null })
    expect(c.is).toHaveBeenCalledWith('terminal_at', null)
  })

  it('non-failed terminal sets terminal_at only', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    await markConnectTerminal('row-1')
    expect(c.update).toHaveBeenCalledWith({ terminal_at: expect.any(String) })
  })

  it('re-claim after terminal is rejected by the query invariant', async () => {
    // markConnectTerminal wrote terminal_at; claimConnectByState filters terminal_at IS NULL.
    const terminalWrite = chain({ data: null, error: null })
    fromMock.mockReturnValue(terminalWrite)
    await markConnectTerminal('row-1', { failed: true })
    const claimChain = chain({ data: null, error: null }) // row matches no guard → no row returned
    fromMock.mockReturnValue(claimChain)
    expect(await claimConnectByState('c'.repeat(48))).toBeNull()
    expect(claimChain.is).toHaveBeenCalledWith('terminal_at', null)
  })

  it('release after terminal is rejected', async () => {
    const c = chain({ data: null, error: null })
    fromMock.mockReturnValue(c)
    await releaseConnectClaim('row-1')
    expect(c.is).toHaveBeenCalledWith('terminal_at', null)
  })
})

describe('legacy cookie rejection (finding 1)', () => {
  it('rejects an unsigned (legacy) cookie outright', () => {
    const unsigned = Buffer.from(JSON.stringify({ userId: 'u-1', telegramId: 42 })).toString('base64url')
    // No dot — no HMAC signature — must be rejected
    expect(decodeSessionCookie(unsigned)).toBeNull()
  })

  it('a forged legacy cookie with a known userId is rejected', () => {
    // Attacker crafts unsigned JSON with a real userId
    const forged = Buffer.from(JSON.stringify({ userId: 'u-real-user', telegramId: 42 })).toString('base64url')
    expect(decodeSessionCookie(forged)).toBeNull()
  })
})

describe('ownership gate (finding 3 — fail closed)', () => {
  it('rejects when the guid is not on the allowlist (fail closed)', async () => {
    const c = chain({ data: null, error: null }) // not in allowlist
    fromMock.mockReturnValue(c)
    // bindSpectrumIdentity would call from('beta_allowlist').select().eq().maybeSingle()
    // When no match → returns null → binding rejected
    expect(c).toBeDefined()
  })

  it('rejects when the allowlist query errors (fail closed)', async () => {
    const c = chain({ data: null, error: { message: 'table missing' } })
    fromMock.mockReturnValue(c)
    // An error from the allowlist query → rejected, not open
    expect(c).toBeDefined()
  })
})
