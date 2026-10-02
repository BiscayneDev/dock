import { beforeEach, describe, expect, it, vi } from 'vitest'
const from = vi.fn()
const rpc = vi.fn(async () => ({ data: null, error: null }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({ from, rpc }) }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (s: string) => s }))
import { loadImessageToolContext, capabilitiesFor, toolsFor } from '@/lib/spectrum/imessage-tools'
function rows(identity: unknown, user: unknown, tokens: unknown[] = []) {
  from.mockImplementation((table: string) => {
    const result = { data: table === 'spectrum_identities' ? identity : table === 'users' ? user : tokens, error: null }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => result, then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve) }) }) }
  })
}
beforeEach(() => { from.mockReset(); rpc.mockClear() })
describe('bound users before OAuth', () => {
  it('keeps the computer and file capabilities without account tokens', async () => {
    rows({ user_id: 'user-a' }, { id: 'user-a', name: 'Ada', timezone: 'America/New_York' })
    const ctx = await loadImessageToolContext('chat-a')
    expect(ctx).toMatchObject({ userId: 'user-a', tokens: {} })
    expect(capabilitiesFor(ctx!)).toMatchObject({ google: false, computer: true, files: true })
    const names = toolsFor(ctx!).map(t => t.name)
    expect(names).toContain('computer_run')
    expect(names).not.toContain('gmail_search')
  })
  it('does not manufacture a context for unbound or deleted users', async () => {
    rows(null, null)
    expect(await loadImessageToolContext('chat-a')).toBeNull()
    rows({ user_id: 'deleted' }, null)
    expect(await loadImessageToolContext('chat-a')).toBeNull()
  })
})
