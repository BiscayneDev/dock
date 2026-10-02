import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.fn()
const rpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from, rpc }) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (s: string) => s }))

import { provisionSpectrumIdentity } from '@/lib/spectrum/provision'
import { loadImessageToolContext, capabilitiesFor, toolsFor } from '@/lib/spectrum/imessage-tools'

/** from() mock: identity row (user_id null = unbound), user row, token rows. */
function tables(identity: { user_id: string | null } | null, user: unknown, tokens: unknown[] = []) {
  from.mockImplementation((table: string) => {
    const result = { data: table === 'spectrum_identities' ? identity : table === 'users' ? user : tokens, error: null }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => result, then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r) }) }) }
  })
}
beforeEach(() => { from.mockReset(); rpc.mockReset() })

describe('provisionSpectrumIdentity', () => {
  it('returns the user id the database function gives back', async () => {
    rpc.mockResolvedValue({ data: 'user-new', error: null })
    expect(await provisionSpectrumIdentity('any;-;+15551230000', '+15551230000')).toBe('user-new')
    expect(rpc).toHaveBeenCalledWith('provision_spectrum_identity', { p_chat_guid: 'any;-;+15551230000', p_handle: '+15551230000' })
  })
  it('returns null for a chat off the allowlist (function returns null) and never throws', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await provisionSpectrumIdentity('any;-;+19990000000')).toBeNull()
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })
    expect(await provisionSpectrumIdentity('x')).toBeNull()
    rpc.mockRejectedValue(new Error('boom'))
    expect(await provisionSpectrumIdentity('x')).toBeNull()
  })
})

describe('invited member with no Google yet', () => {
  it('gets a user bound on first message and keeps computer + files tools without any OAuth token', async () => {
    tables({ user_id: null }, { id: 'user-new', name: 'iMessage user', timezone: 'UTC' })
    rpc.mockResolvedValue({ data: 'user-new', error: null })
    const ctx = await loadImessageToolContext('any;-;+15551230000')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(ctx).toMatchObject({ userId: 'user-new', tokens: {} })
    expect(capabilitiesFor(ctx!)).toMatchObject({ google: false, computer: true, files: true })
    const names = toolsFor(ctx!).map((t) => t.name)
    expect(names).toContain('computer_run')
    expect(names).not.toContain('gmail_search')
  })
  it('a stranger (not allowlisted) stays unbound: no context, no tools', async () => {
    tables({ user_id: null }, null)
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await loadImessageToolContext('any;-;+19990000000')).toBeNull()
  })
  it('an already-bound chat does not call the provisioner', async () => {
    tables({ user_id: 'user-a' }, { id: 'user-a', name: 'A', timezone: 'America/New_York' })
    await loadImessageToolContext('chat-a')
    expect(rpc).not.toHaveBeenCalled()
  })
  it('a failed provision degrades to the no-tools path instead of throwing', async () => {
    tables({ user_id: null }, null)
    rpc.mockRejectedValue(new Error('boom'))
    expect(await loadImessageToolContext('any;-;+15551230000')).toBeNull()
  })
})
