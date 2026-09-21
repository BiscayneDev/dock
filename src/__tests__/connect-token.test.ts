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
  completeConnectByState,
  claimPendingResume,
} from '@/lib/connect-token'

type Chain = {
  update: Mock
  eq: Mock
  is: Mock
  gt: Mock
  not: Mock
  select: Mock
  order: Mock
  limit: Mock
  maybeSingle: Mock
  insert: Mock
}

function chain(final: { data: unknown; error: unknown }): Chain {
  const c: Record<string, Mock> = {}
  for (const m of ['update', 'eq', 'is', 'gt', 'not', 'select', 'order', 'limit', 'insert']) {
    c[m] = vi.fn().mockReturnThis()
  }
  c.maybeSingle = vi.fn().mockResolvedValue(final)
  return c as unknown as Chain
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

describe('completeConnectByState', () => {
  it('claims a consumed-but-incomplete row exactly once', async () => {
    const c = chain({ data: { id: 'row-1', platform: 'imessage', chat_id: 'guid-1', pending_request: 'check my email' }, error: null })
    fromMock.mockReturnValue(c)

    const row = await completeConnectByState('a'.repeat(48))
    expect(row).toMatchObject({ platform: 'imessage', chatId: 'guid-1', pendingRequest: 'check my email' })
    expect(c.update).toHaveBeenCalledWith(expect.objectContaining({ completed_at: expect.any(String) }))
    expect(c.is).toHaveBeenCalledWith('completed_at', null)
  })

  it('returns null for an unknown state', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    expect(await completeConnectByState('f'.repeat(48))).toBeNull()
  })
})

describe('claimPendingResume', () => {
  it('returns the pending request for a completed, unresumed token', async () => {
    const c = chain({ data: { pending_request: 'what meetings do I have' }, error: null })
    fromMock.mockReturnValue(c)

    expect(await claimPendingResume('guid-1')).toEqual({ pendingRequest: 'what meetings do I have' })
    expect(c.eq).toHaveBeenCalledWith('platform', 'imessage')
    expect(c.eq).toHaveBeenCalledWith('chat_id', 'guid-1')
  })

  it('returns null when nothing is pending', async () => {
    fromMock.mockReturnValue(chain({ data: null, error: null }))
    expect(await claimPendingResume('guid-2')).toBeNull()
  })
})
