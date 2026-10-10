import { readFileSync } from 'fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => db }))
vi.mock('@/lib/crypto', () => ({ decryptTokenFromDb: (value: string) => value }))
import { loadImessageToolContext } from '@/lib/spectrum/imessage-tools'

afterEach(() => vi.restoreAllMocks())

describe('reply context overlap', () => {
  it('starts user and token reads together only after verifying the binding', async () => {
    let releaseUser!: (value: unknown) => void
    const user = new Promise(resolve => { releaseUser = resolve })
    const tables: string[] = []
    db.from.mockImplementation((table: string) => {
      tables.push(table)
      const result = table === 'spectrum_identities'
        ? { data: { user_id: 'user-a' }, error: null }
        : table === 'users' ? user : Promise.resolve({ data: [], error: null })
      const q = { select: () => q, eq: (_key: string, value: string) => {
        if (table !== 'spectrum_identities') expect(value).toBe('user-a')
        return q
      }, maybeSingle: () => Promise.resolve(result), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
      return q
    })
    const run = loadImessageToolContext('chat-a')
    await Promise.resolve()
    await Promise.resolve()
    expect(tables).toEqual(['spectrum_identities', 'users', 'oauth_tokens'])
    releaseUser({ data: { id: 'user-a', name: 'A', timezone: 'UTC' }, error: null })
    expect(await run).toMatchObject({ userId: 'user-a', name: 'A', tokens: {} })
  })

  it('still rejects a failed user lookup even when the token lookup succeeds', async () => {
    db.from.mockImplementation((table: string) => {
      const result = table === 'spectrum_identities'
        ? { data: { user_id: 'user-a' }, error: null }
        : table === 'users' ? { data: null, error: { message: 'down' } }
        : { data: [], error: null }
      const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve(result), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) }
      return q
    })
    expect(await loadImessageToolContext('chat-a')).toBeNull()
  })

  it('overlaps independent history, facts and memory without caching credentials or pinning a model', () => {
    const handler = readFileSync('src/lib/spectrum/handler.ts', 'utf8')
    expect(handler).toContain('const [memory, history, loadedFacts] = await Promise.all([')
    expect(handler).toContain('preflight_ms=')
    expect(handler).toContain('gatewayMs: usage.reduce')
    expect(handler).toContain('const routing = routingFor()')
    const memory = readFileSync('src/lib/spectrum/memory.ts', 'utf8')
    expect(memory).toContain('const [userId, embedding] = await Promise.all([')
    expect(memory).toContain('EMBED_READ_TIMEOUT_MS).catch(() => null)')
  })
})
