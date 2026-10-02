import { describe, it, expect, vi, beforeEach } from 'vitest'

const mint = vi.fn()
vi.mock('@/lib/browser-sessions/login', () => ({ mintLoginLink: (...a: unknown[]) => mint(...a) }))
const list = vi.fn()
const revoke = vi.fn()
const audit = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('@/lib/capabilities/store', () => ({ listCapabilities: (...a: unknown[]) => list(...a), revokeCapabilities: (...a: unknown[]) => revoke(...a), auditEvent: (...a: unknown[]) => audit(...a) }))

import { browserConnect, browserSessions, browserDisconnect } from '@/lib/tools/browser-sessions'
import type { UserContext } from '@/lib/llm/types'

const ctx = { userId: 'u1', chatGuid: 'chat1' } as unknown as UserContext

beforeEach(() => { mint.mockReset(); list.mockReset(); revoke.mockReset() })

describe('browser tools', () => {
  it('connect returns the link and a no-passwords instruction', async () => {
    mint.mockResolvedValue({ ok: true, url: 'https://x/connect/browser?t=abc', site: 'github.com', minutes: 15 })
    const r = await browserConnect.execute({ site: 'github.com' }, ctx)
    expect(r.success).toBe(true)
    expect(JSON.stringify(r.data)).toMatch(/Never ask them to text a password/)
    expect(mint).toHaveBeenCalledWith('u1', 'chat1', 'github.com')
  })
  it('connect surfaces a refusal', async () => {
    mint.mockResolvedValue({ ok: false, error: "I don't hold logins for banks" })
    const r = await browserConnect.execute({ site: 'chase.com' }, ctx)
    expect(r.success).toBe(false)
  })
  it('list never returns secrets', async () => {
    list.mockResolvedValue([{ label: 'github.com', mode: 'read', expires_at: 'e', last_used_at: null, secret_enc: 'zzz' }])
    const r = await browserSessions.execute({}, ctx)
    expect(JSON.stringify(r.data)).not.toContain('zzz')
    expect(JSON.stringify(r.data)).toContain('github.com')
  })
  it('disconnect one site, or all', async () => {
    revoke.mockResolvedValue(1)
    await browserDisconnect.execute({ site: 'https://www.GitHub.com' }, ctx)
    expect(revoke).toHaveBeenCalledWith('u1', 'browser_session', 'github.com')
    await browserDisconnect.execute({ all: true }, ctx)
    expect(revoke).toHaveBeenLastCalledWith('u1', 'browser_session')
    const bad = await browserDisconnect.execute({}, ctx)
    expect(bad.success).toBe(false)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'disconnected', label: 'github.com' }))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'disconnected', label: '*' }))
  })
})
