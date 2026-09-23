import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Mock Supabase before importing the module under test.
const insertMock = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({ from: () => ({ insert: insertMock }) }),
}))

process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef'

import {
  generateMagicToken,
  verifyMagicToken,
  buildMagicLink,
} from '@/lib/auth/magic-link'

const PAYLOAD = {
  telegramId: 12345,
  name: 'Test User',
  username: 'testuser',
  ts: Date.now(),
}

describe('magic link single-use tokens', () => {
  beforeEach(() => {
    insertMock.mockReset()
  })

  it('first verify succeeds and consumes the token', async () => {
    insertMock.mockResolvedValue({ error: null })
    const token = generateMagicToken(PAYLOAD)
    const payload = await verifyMagicToken(token)
    expect(payload).not.toBeNull()
    expect(payload?.telegramId).toBe(12345)
    expect(insertMock).toHaveBeenCalledWith({ jti: payload?.jti })
  })

  it('second verify fails (replay blocked by unique violation)', async () => {
    const token = generateMagicToken(PAYLOAD)
    insertMock.mockResolvedValueOnce({ error: null })
    insertMock.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })

    await expect(verifyMagicToken(token)).resolves.not.toBeNull()
    await expect(verifyMagicToken(token)).resolves.toBeNull()
  })

  it('wrong signature fails and never touches the consumed table', async () => {
    const token = generateMagicToken(PAYLOAD)
    const [encoded] = token.split('.')
    insertMock.mockResolvedValue({ error: null })

    const forged = `${encoded}.${'0'.repeat(64)}`
    await expect(verifyMagicToken(forged)).resolves.toBeNull()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('expired token fails', async () => {
    insertMock.mockResolvedValue({ error: null })
    const token = generateMagicToken({ ...PAYLOAD, ts: Date.now() - 16 * 60 * 1000 })
    await expect(verifyMagicToken(token)).resolves.toBeNull()
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('fails closed when consumption cannot be recorded', async () => {
    insertMock.mockResolvedValue({ error: { code: 'P0001', message: 'db down' } })
    const token = generateMagicToken(PAYLOAD)
    await expect(verifyMagicToken(token)).resolves.toBeNull()
  })

  it('malformed token fails', async () => {
    insertMock.mockResolvedValue({ error: null })
    await expect(verifyMagicToken('garbage')).resolves.toBeNull()
    await expect(verifyMagicToken('a.b.c')).resolves.toBeNull()
  })

  it('buildMagicLink embeds a token with a jti', async () => {
    insertMock.mockResolvedValue({ error: null })
    const link = buildMagicLink(PAYLOAD)
    expect(link).toMatch(/\?token=/)
    const token = new URL(link).searchParams.get('token') as string
    const payload = await verifyMagicToken(token)
    expect(payload?.jti).toBeTruthy()
  })
})
